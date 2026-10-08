import { CLOSE, KEEPALIVE_DEAD_MS, KEEPALIVE_MS } from '../../shared/constants'
import type { ClientMessage, ServerMessage } from '../../shared/protocol'

export type SocketStatus = 'connecting' | 'open' | 'reconnecting' | 'closed'

export interface RoomSocketOptions {
  url: string
  participantId: string
  /** `isSnapshot` is true for the first room-state after every (re)open (the join snapshot). */
  onMessage: (message: ServerMessage, isSnapshot: boolean) => void
  onStatus: (status: SocketStatus, closeCode: number | null) => void
  WebSocketImpl?: typeof WebSocket
  backoffMs?: readonly number[]
  giveUpAfterMs?: number
  now?: () => number
}

const TERMINAL = new Set<number>(Object.values(CLOSE))
const WS_OPEN = 1

/** Reconnecting WebSocket for one booth. Rejoins with the same participantId; the server swaps the old socket out. */
export class RoomSocket {
  private ws: WebSocket | null = null
  private attempt = 0
  private downSince: number | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private stopped = false
  private snapshotPending = true
  private keepTimer: ReturnType<typeof setInterval> | null = null
  private lastRx = 0

  constructor(private readonly o: RoomSocketOptions) {
    this.o.onStatus('connecting', null)
    this.connect()
  }

  send(message: ClientMessage): boolean {
    if (this.ws?.readyState !== WS_OPEN) return false
    this.ws.send(JSON.stringify(message))
    return true
  }

  /** Close and rejoin right now (also restarts a socket that gave up). This is what RECONNECT buttons call. */
  reconnect(): void {
    this.clearTimer()
    this.detach()
    this.stopped = false
    this.attempt = 0
    this.downSince = null
    this.o.onStatus('reconnecting', null)
    this.connect()
  }

  close(): void {
    this.stopped = true
    this.clearTimer()
    this.detach()
  }

  private connect(): void {
    const Impl = this.o.WebSocketImpl ?? WebSocket
    this.snapshotPending = true
    const ws = new Impl(this.o.url)
    this.ws = ws
    ws.addEventListener('open', () => {
      if (this.ws !== ws) return
      this.attempt = 0
      this.downSince = null
      this.lastRx = this.clock()
      this.startKeepalive(ws)
      this.o.onStatus('open', null)
      ws.send(JSON.stringify({ type: 'join', participantId: this.o.participantId } satisfies ClientMessage))
    })
    ws.addEventListener('message', (e) => {
      if (this.ws !== ws) return
      this.lastRx = this.clock() // anything at all proves the connection is alive, including the 'ok' keepalive reply
      if (typeof e.data !== 'string') return
      let message: ServerMessage
      try {
        message = JSON.parse(e.data) as ServerMessage
      } catch {
        return
      }
      const isSnapshot = this.snapshotPending && message.type === 'room-state'
      if (isSnapshot) this.snapshotPending = false
      this.o.onMessage(message, isSnapshot)
    })
    ws.addEventListener('close', (e) => {
      if (this.ws !== ws) return
      this.ws = null
      this.stopKeepalive()
      this.onClosed(e.code)
    })
  }

  private onClosed(code: number): void {
    if (this.stopped) return
    if (TERMINAL.has(code)) {
      this.stopped = true
      this.o.onStatus('closed', code)
      return
    }
    const now = this.clock()
    this.downSince ??= now
    if (now - this.downSince > (this.o.giveUpAfterMs ?? 60_000)) {
      this.stopped = true
      this.o.onStatus('closed', code)
      return
    }
    const delays = this.o.backoffMs ?? [500, 1000, 2000, 4000, 5000]
    const delay = delays[Math.min(this.attempt, delays.length - 1)] ?? 5000
    this.attempt += 1
    this.o.onStatus('reconnecting', null)
    this.timer = setTimeout(() => {
      this.timer = null
      this.connect()
    }, delay)
  }

  private clock(): number {
    return (this.o.now ?? Date.now)()
  }

  /** Ping every KEEPALIVE_MS; if nothing at all has arrived for KEEPALIVE_DEAD_MS the socket is half-open: drop it and reconnect. */
  private startKeepalive(ws: WebSocket): void {
    this.stopKeepalive()
    this.keepTimer = setInterval(() => {
      if (this.ws !== ws) return
      if (this.clock() - this.lastRx > KEEPALIVE_DEAD_MS) {
        this.stopKeepalive()
        this.ws = null
        try {
          ws.close(1000)
        } catch {
          // already closed
        }
        this.onClosed(1006)
      } else if (ws.readyState === WS_OPEN) {
        ws.send('ka')
      }
    }, KEEPALIVE_MS)
  }

  private stopKeepalive(): void {
    if (this.keepTimer !== null) clearInterval(this.keepTimer)
    this.keepTimer = null
  }

  private detach(): void {
    this.stopKeepalive()
    const ws = this.ws
    this.ws = null
    if (!ws) return
    try {
      ws.close(1000)
    } catch {
      // already closed
    }
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
  }
}
