import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServerMessage } from '../../shared/protocol'
import { RoomSocket, type SocketStatus } from './room-socket'

type Listener = (e: { data?: unknown; code?: number }) => void

class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  readyState = 0
  sent: string[] = []
  closedByClient = false
  private listeners = new Map<string, Listener[]>()
  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this)
  }
  addEventListener(type: string, fn: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn])
  }
  send(text: string) {
    this.sent.push(text)
  }
  close() {
    this.closedByClient = true
    this.readyState = 3
  }
  // --- test drivers
  open() {
    this.readyState = 1
    this.emit('open', {})
  }
  message(m: unknown) {
    this.emit('message', { data: JSON.stringify(m) })
  }
  raw(text: string) {
    this.emit('message', { data: text })
  }
  drop(code: number) {
    this.readyState = 3
    this.emit('close', { code })
  }
  private emit(type: string, e: { data?: unknown; code?: number }) {
    for (const fn of this.listeners.get(type) ?? []) fn(e)
  }
}

const STATE: ServerMessage = {
  type: 'room-state',
  state: { code: 'ABCDEF', you: 'a', phase: 'waiting', round: 0, captureAt: null, participants: { a: null, b: null } },
}

function make(extra: Partial<ConstructorParameters<typeof RoomSocket>[0]> = {}) {
  const statuses: Array<[SocketStatus, number | null]> = []
  const messages: Array<[ServerMessage, boolean]> = []
  const socket = new RoomSocket({
    url: 'ws://x/api/rooms/ABCDEF/ws',
    participantId: 'participant-1-test',
    onMessage: (m, snap) => messages.push([m, snap]),
    onStatus: (s, c) => statuses.push([s, c]),
    WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
    ...extra,
  })
  const last = () => FakeWebSocket.instances[FakeWebSocket.instances.length - 1]!
  return { socket, statuses, messages, last }
}

beforeEach(() => {
  FakeWebSocket.instances = []
  vi.useFakeTimers()
})
afterEach(() => vi.useRealTimers())

describe('RoomSocket', () => {
  it('joins on open and flags only the first room-state per connection as the snapshot', () => {
    const { last, messages, statuses } = make()
    expect(statuses[0]).toEqual(['connecting', null])
    last().open()
    expect(JSON.parse(last().sent[0]!)).toEqual({ type: 'join', participantId: 'participant-1-test' })
    last().message(STATE)
    last().message(STATE)
    expect(messages.map(([, snap]) => snap)).toEqual([true, false])
    expect(statuses.at(-1)).toEqual(['open', null])
  })

  it('reconnects with backoff after an abnormal close, and re-flags the snapshot', () => {
    const { last, statuses, messages } = make()
    last().open()
    last().message(STATE)
    last().drop(1006)
    expect(statuses.at(-1)).toEqual(['reconnecting', null])
    expect(FakeWebSocket.instances).toHaveLength(1)
    vi.advanceTimersByTime(499)
    expect(FakeWebSocket.instances).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(FakeWebSocket.instances).toHaveLength(2)
    last().open()
    last().message(STATE)
    expect(messages.map(([, snap]) => snap)).toEqual([true, true])
  })

  it('backs off progressively and resets after a successful open', () => {
    const { last } = make()
    last().drop(1006)
    vi.advanceTimersByTime(500)
    last().drop(1006)
    vi.advanceTimersByTime(999)
    expect(FakeWebSocket.instances).toHaveLength(2)
    vi.advanceTimersByTime(1)
    expect(FakeWebSocket.instances).toHaveLength(3)
    last().open()
    last().drop(1006)
    vi.advanceTimersByTime(500)
    expect(FakeWebSocket.instances).toHaveLength(4)
  })

  it.each([4000, 4001, 4400, 4403, 4404, 4429])('does not retry terminal close code %i', (code) => {
    const { last, statuses } = make()
    last().open()
    last().drop(code)
    expect(statuses.at(-1)).toEqual(['closed', code])
    vi.advanceTimersByTime(60_000)
    expect(FakeWebSocket.instances).toHaveLength(1)
  })

  it('gives up after being down longer than giveUpAfterMs', () => {
    let t = 0
    const { last, statuses } = make({ giveUpAfterMs: 5_000, now: () => t })
    last().drop(1006)
    t = 6_000
    vi.advanceTimersByTime(500)
    last().drop(1006)
    expect(statuses.at(-1)).toEqual(['closed', 1006])
  })

  it('reconnect() drops the current socket, rejoins immediately and ignores the old one', () => {
    const { socket, last, messages } = make()
    last().open()
    const old = last()
    socket.reconnect()
    expect(old.closedByClient).toBe(true)
    expect(FakeWebSocket.instances).toHaveLength(2)
    old.message(STATE) // late event from the discarded socket
    expect(messages).toHaveLength(0)
    last().open()
    last().message(STATE)
    expect(messages).toHaveLength(1)
  })

  it('reconnect() restarts a socket that had given up', () => {
    const { socket, last, statuses } = make()
    last().drop(4404)
    expect(statuses.at(-1)?.[0]).toBe('closed')
    socket.reconnect()
    expect(FakeWebSocket.instances).toHaveLength(2)
  })

  it('send() reports whether the socket was open, and close() stops everything', () => {
    const { socket, last } = make()
    expect(socket.send({ type: 'ready' })).toBe(false)
    last().open()
    expect(socket.send({ type: 'ready' })).toBe(true)
    socket.close()
    last().drop(1006) // a late close event after close() must not schedule a retry
    vi.advanceTimersByTime(60_000)
    expect(FakeWebSocket.instances).toHaveLength(1)
  })

  it('ignores frames that are not valid JSON, and keeps working afterwards', () => {
    const { last, messages } = make()
    last().open()
    last().raw('{not json')
    expect(messages).toHaveLength(0)
    last().message(STATE)
    expect(messages).toHaveLength(1)
  })
})
