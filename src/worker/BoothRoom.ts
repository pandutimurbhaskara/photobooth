import { DurableObject } from 'cloudflare:workers'
import {
  ACTIVITY_PERSIST_MS,
  CLOSE,
  EXCHANGE_TIMEOUT_MS,
  MAX_SOCKETS,
  ROOM_IDLE_MS,
  SLOT_GRACE_MS,
} from '../shared/constants'
import { decodeClientFrame, otherSlot } from '../shared/protocol'
import type { ErrorCode, Phase, PState, RoomState, ServerMessage, SlotName } from '../shared/protocol'

const WS_OPEN = 1
const SLOTS: readonly SlotName[] = ['a', 'b']

interface Slot {
  participantId: string
  ready: boolean
  photoDone: boolean
  lastSeenAt: number
}
interface RoomRecord {
  code: string
  createdAt: number
  lastActivityAt: number
  round: number
  captureAt: number | null
  slots: Partial<Record<SlotName, Slot>>
}
interface Attachment {
  slot: SlotName
}

/**
 * One booth. Hibernating WebSocket server: carries signaling, ready state, clock sync and
 * capture scheduling only — never media, never photos. The persisted record holds no names,
 * IPs or media; `participantId` is the membership secret and is never sent to the partner.
 */
export class BoothRoom extends DurableObject<Env> {
  private rec: RoomRecord | null = null
  private persistedActivityAt = 0
  /** Sockets we know are going away (replaced or closed): excluded from "connected". */
  private readonly closing = new WeakSet<WebSocket>()

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    void ctx.blockConcurrencyWhile(async () => {
      this.rec = (await ctx.storage.get<RoomRecord>('room')) ?? null
    })
  }

  // ---- RPC (called from the Worker) -------------------------------------------------------

  async create(code: string): Promise<boolean> {
    if (this.rec) return false
    const now = Date.now()
    this.rec = { code, createdAt: now, lastActivityAt: now, round: 0, captureAt: null, slots: {} }
    this.save()
    await this.ctx.storage.setAlarm(now + ROOM_IDLE_MS)
    return true
  }

  async status(participantId: string | null): Promise<{ exists: boolean; full: boolean }> {
    if (!this.rec) return { exists: false, full: false }
    const isMember = participantId !== null && this.slotOf(participantId) !== null
    return { exists: true, full: !isMember && this.freeSlot(Date.now()) === null }
  }

  // ---- WebSocket upgrade ------------------------------------------------------------------

  async fetch(request: Request): Promise<Response> {
    if (!this.rec) return new Response('not found', { status: 404 })
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 })
    if (this.ctx.getWebSockets().length >= MAX_SOCKETS) return new Response('busy', { status: 429 })
    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)
    this.ctx.acceptWebSocket(server)
    return new Response(null, { status: 101, webSocket: client })
  }

  // ---- Hibernation handlers ---------------------------------------------------------------

  async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer): Promise<void> {
    if (!this.rec) return this.reject(ws, 'room-not-found', CLOSE.NOT_FOUND)
    const msg = decodeClientFrame(data)
    if (msg === null) return this.reject(ws, 'invalid-message')
    const att = ws.deserializeAttachment() as Attachment | null
    if (msg.type === 'join') {
      if (att) return this.reject(ws, 'invalid-message')
      return this.handleJoin(ws, msg.participantId)
    }
    if (!att) return this.reject(ws, 'not-joined')
    this.touch(Date.now())
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    this.onGone(ws)
    try {
      ws.close(code === 1000 || (code >= 3000 && code <= 4999) ? code : 1000, 'bye')
    } catch {
      // already closed
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.onGone(ws)
  }

  // ---- Join / leave -----------------------------------------------------------------------

  private handleJoin(ws: WebSocket, participantId: string): void {
    const rec = this.room
    const now = Date.now()
    let slot = this.slotOf(participantId)
    if (slot === null) {
      slot = this.freeSlot(now)
      if (slot === null) return this.reject(ws, 'room-full', CLOSE.FULL)
      rec.slots[slot] = { participantId, ready: false, photoDone: false, lastSeenAt: now }
    }
    ws.serializeAttachment({ slot } satisfies Attachment)
    for (const live of this.live()) {
      if (live.slot === slot && live.ws !== ws) {
        this.closing.add(live.ws) // replaced: its close event must not read as a departure
        live.ws.close(CLOSE.REPLACED, 'replaced')
      }
    }
    const me = rec.slots[slot]
    if (me) me.lastSeenAt = now
    this.touch(now)
    this.save()

    this.send(ws, { type: 'room-state', state: this.stateFor(slot, now) }) // join snapshot is always first
    this.sendTo(otherSlot(slot), { type: 'partner-joined' })
    for (const other of this.live()) {
      if (other.ws !== ws) this.send(other.ws, { type: 'room-state', state: this.stateFor(other.slot, now) })
    }
  }

  private onGone(ws: WebSocket): void {
    if (this.closing.has(ws)) return
    this.closing.add(ws)
    const rec = this.rec
    const att = ws.deserializeAttachment() as Attachment | null
    if (!rec || !att) return
    if (this.live().some((s) => s.slot === att.slot)) return // another live socket holds this slot
    const me = rec.slots[att.slot]
    if (!me) return
    me.ready = false
    me.lastSeenAt = Date.now()
    rec.captureAt = null // a round in flight is cancelled when anyone leaves
    this.save()
    this.sendTo(otherSlot(att.slot), { type: 'partner-left' })
    this.broadcastState()
  }

  // ---- State helpers ----------------------------------------------------------------------

  private get room(): RoomRecord {
    if (!this.rec) throw new Error('room was never created')
    return this.rec
  }

  private save(): void {
    void this.ctx.storage.put('room', this.rec)
  }

  private touch(now: number): void {
    this.room.lastActivityAt = now
    if (now - this.persistedActivityAt >= ACTIVITY_PERSIST_MS) {
      this.persistedActivityAt = now
      this.save()
    }
  }

  private slotOf(participantId: string): SlotName | null {
    for (const name of SLOTS) if (this.rec?.slots[name]?.participantId === participantId) return name
    return null
  }

  /** A slot a *new* participant may take: empty, or its owner has been gone past the grace period. */
  private freeSlot(now: number): SlotName | null {
    const connected = this.connected()
    for (const name of SLOTS) {
      const s = this.rec?.slots[name]
      if (!s) return name
      if (!connected.has(name) && now - s.lastSeenAt > SLOT_GRACE_MS) return name
    }
    return null
  }

  private live(): Array<{ ws: WebSocket; slot: SlotName }> {
    const out: Array<{ ws: WebSocket; slot: SlotName }> = []
    for (const ws of this.ctx.getWebSockets()) {
      if (ws.readyState !== WS_OPEN || this.closing.has(ws)) continue
      const att = ws.deserializeAttachment() as Attachment | null
      if (att) out.push({ ws, slot: att.slot })
    }
    return out
  }

  private connected(): Set<SlotName> {
    return new Set(this.live().map((s) => s.slot))
  }

  private phase(now: number): Phase {
    const rec = this.room
    if (rec.captureAt !== null && now >= rec.captureAt + EXCHANGE_TIMEOUT_MS) {
      rec.captureAt = null
      this.save()
    }
    if (this.connected().size < 2) return 'waiting'
    return rec.captureAt !== null ? 'capture' : 'ready'
  }

  private stateFor(slot: SlotName, now: number): RoomState {
    const rec = this.room
    const phase = this.phase(now) // may clear an expired capture, so compute before reading captureAt
    const connected = this.connected()
    const p = (name: SlotName): PState | null => {
      const s = rec.slots[name]
      return s ? { connected: connected.has(name), ready: s.ready, photoDone: s.photoDone } : null
    }
    return { code: rec.code, you: slot, phase, round: rec.round, captureAt: rec.captureAt, participants: { a: p('a'), b: p('b') } }
  }

  // ---- Sending ----------------------------------------------------------------------------

  private send(ws: WebSocket, msg: ServerMessage): void {
    try {
      ws.send(JSON.stringify(msg))
    } catch {
      // socket is closing; its close handler will clean up
    }
  }

  private sendTo(slot: SlotName, msg: ServerMessage): void {
    for (const s of this.live()) if (s.slot === slot) this.send(s.ws, msg)
  }

  private broadcastState(): void {
    const now = Date.now()
    for (const s of this.live()) this.send(s.ws, { type: 'room-state', state: this.stateFor(s.slot, now) })
  }

  private reject(ws: WebSocket, code: ErrorCode, closeCode: number = CLOSE.INVALID): void {
    this.send(ws, { type: 'error', code })
    try {
      ws.close(closeCode, code)
    } catch {
      // already closed
    }
  }
}
