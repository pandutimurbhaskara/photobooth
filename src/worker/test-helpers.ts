import { env } from 'cloudflare:workers'
import { generateRoomCode } from '../shared/room-code'
import type { Plan } from '../shared/plan'
import type { ClientMessage, RoomState, ServerMessage } from '../shared/protocol'

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
const open: TestClient[] = []

export class TestClient {
  messages: ServerMessage[] = []
  /** Frames that are not JSON (e.g. the 'ok' keepalive reply). */
  raw: string[] = []
  closeCode: number | null = null
  private wake: (() => void) | null = null

  constructor(readonly ws: WebSocket) {
    ws.addEventListener('message', (e) => {
      const text = e.data as string
      try {
        this.messages.push(JSON.parse(text) as ServerMessage)
      } catch {
        this.raw.push(text)
      }
      this.wake?.()
    })
    ws.addEventListener('close', (e) => {
      this.closeCode = e.code
      this.wake?.()
    })
    open.push(this)
  }

  send(message: ClientMessage | Record<string, unknown>): void {
    this.ws.send(JSON.stringify(message))
  }
  sendRaw(text: string): void {
    this.ws.send(text)
  }
  clear(): void {
    this.messages.length = 0
  }
  /** Let in-flight messages land, then drop everything queued. Use this (not clear) right after take(): the server often sends two messages back to back. */
  async settle(ms = 60): Promise<void> {
    await sleep(ms)
    this.messages.length = 0
  }
  /** Let in-flight messages land, then return the newest room-state and drop the queue. */
  async lastState(ms = 80): Promise<RoomState> {
    await sleep(ms)
    const states = this.messages.filter((m): m is Extract<ServerMessage, { type: 'room-state' }> => m.type === 'room-state')
    this.messages.length = 0
    const last = states[states.length - 1]
    if (!last) throw new Error('no room-state arrived')
    return last.state
  }

  private async until<T>(probe: () => T | undefined, what: string, ms: number): Promise<T> {
    const end = Date.now() + ms
    for (;;) {
      const value = probe()
      if (value !== undefined) return value
      if (Date.now() > end) {
        throw new Error(`timeout waiting for ${what}; queue=${JSON.stringify(this.messages)} close=${this.closeCode}`)
      }
      await Promise.race([new Promise<void>((resolve) => (this.wake = resolve)), sleep(25)])
    }
  }

  /** Remove and return the first queued message of `type`, waiting for it if needed. */
  take<T extends ServerMessage['type']>(type: T, ms = 2000): Promise<Extract<ServerMessage, { type: T }>> {
    return this.until(() => {
      const i = this.messages.findIndex((m) => m.type === type)
      return i < 0 ? undefined : (this.messages.splice(i, 1)[0] as Extract<ServerMessage, { type: T }>)
    }, type, ms)
  }
  takeRaw(text: string, ms = 2000): Promise<string> {
    return this.until(() => {
      const i = this.raw.indexOf(text)
      return i < 0 ? undefined : this.raw.splice(i, 1)[0]
    }, `raw "${text}"`, ms)
  }
  waitClose(ms = 2000): Promise<number> {
    return this.until(() => this.closeCode ?? undefined, 'close', ms)
  }
  async expectNone(type: ServerMessage['type'], ms = 150): Promise<void> {
    await sleep(ms)
    if (this.messages.some((m) => m.type === type)) throw new Error(`unexpected "${type}" in ${JSON.stringify(this.messages)}`)
  }
}

export const pid = (n: number): string => `participant-${n}-test`

export async function newRoom(code: string = generateRoomCode()): Promise<string> {
  await env.BOOTH_ROOM.getByName(code).create(code)
  return code
}

export async function openSocket(code: string): Promise<TestClient> {
  const res = await env.BOOTH_ROOM.getByName(code).fetch('https://booth.test/ws', { headers: { Upgrade: 'websocket' } })
  if (!res.webSocket) throw new Error(`no websocket, status ${res.status}`)
  res.webSocket.accept()
  return new TestClient(res.webSocket)
}

/** Open, send `join`, and consume the join snapshot. */
export async function joinAs(code: string, n: number): Promise<TestClient> {
  const client = await openSocket(code)
  client.send({ type: 'join', participantId: pid(n) })
  await client.take('room-state')
  return client
}

export function closeAll(): void {
  for (const c of open.splice(0)) {
    try {
      c.ws.close(1000, 'test over')
    } catch {
      // already closed
    }
  }
}

/** Test-only view into the (private) persisted record. */
export interface Peek {
  rec: {
    lastActivityAt: number
    captureAt: number | null
    round: number
    slots: Record<string, { participantId: string; ready: boolean; photoDone: boolean; lastSeenAt: number } | undefined>
    plan?: Plan
  }
}
export const peek = (instance: unknown): Peek => instance as Peek
