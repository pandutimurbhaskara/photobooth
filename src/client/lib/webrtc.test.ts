import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Peer, type PeerOptions, type PeerState, type SignalOut } from './webrtc'

class FakeChannel {
  binaryType = ''
  bufferedAmountLowThreshold = 0
  bufferedAmount = 0
  readyState = 'connecting'
  onopen: (() => void) | null = null
  onmessage: ((e: { data: unknown }) => void) | null = null
  onbufferedamountlow: (() => void) | null = null
  sent: unknown[] = []
  send(d: unknown) {
    this.sent.push(d)
  }
  close() {
    this.readyState = 'closed'
  }
}

class FakePC {
  static last: FakePC
  remoteDescription: { type: string; sdp: string } | null = null
  localDescription: { type: string; sdp: string } | null = null
  iceConnectionState = 'new'
  added: unknown[] = []
  failCandidates = false
  closed = false
  channel = new FakeChannel()
  ontrack: unknown = null
  onicecandidate: unknown = null
  oniceconnectionstatechange: (() => void) | null = null
  constructor(readonly config: unknown) {
    FakePC.last = this
  }
  createDataChannel() {
    return this.channel
  }
  addTrack() {}
  async createOffer() {
    return { type: 'offer', sdp: 'v=0 offer' }
  }
  async setLocalDescription(d?: { type: string; sdp: string }) {
    this.localDescription = d ?? { type: 'answer', sdp: 'v=0 answer' }
  }
  async setRemoteDescription(d: { type: string; sdp: string }) {
    this.remoteDescription = d
  }
  async addIceCandidate(c: unknown) {
    if (this.failCandidates) throw new Error('stale candidate')
    this.added.push(c)
  }
  getSenders() {
    return []
  }
  close() {
    this.closed = true
  }
}

function make(extra: Partial<PeerOptions> = {}) {
  const signals: SignalOut[] = []
  const states: PeerState[] = []
  const peer = new Peer({
    iceServers: [],
    localStream: null,
    signal: (m) => signals.push(m),
    onRemoteStream: () => {},
    onState: (s) => states.push(s),
    onChannelOpen: () => {},
    onChannelText: () => {},
    onChannelBinary: () => {},
    PeerConnectionImpl: FakePC as unknown as typeof RTCPeerConnection,
    ...extra,
  })
  return { peer, signals, states, pc: () => FakePC.last }
}

const CAND = { candidate: 'candidate:1 1 udp 1 10.0.0.2 1 typ host', sdpMid: '0', sdpMLineIndex: 0 }
const OFFER = { type: 'offer', sdp: 'v=0 remote offer' } as const

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('Peer', () => {
  it('start() creates an offer and signals it', async () => {
    const { peer, signals } = make()
    await peer.start()
    expect(signals).toEqual([{ type: 'offer', offer: { type: 'offer', sdp: 'v=0 offer' } }])
  })

  it('answers an incoming offer', async () => {
    const { peer, signals, pc } = make()
    await peer.handleSignal({ type: 'offer', offer: OFFER })
    expect(pc().remoteDescription?.sdp).toBe('v=0 remote offer')
    expect(signals).toEqual([{ type: 'answer', answer: { type: 'answer', sdp: 'v=0 answer' } }])
  })

  it('buffers remote candidates until the remote description exists, then flushes in order', async () => {
    const { peer, pc } = make()
    await peer.handleSignal({ type: 'ice-candidate', candidate: { ...CAND, candidate: 'c1' } })
    await peer.handleSignal({ type: 'ice-candidate', candidate: { ...CAND, candidate: 'c2' } })
    expect(pc().added).toHaveLength(0)
    await peer.handleSignal({ type: 'offer', offer: OFFER })
    expect(pc().added.map((c) => (c as { candidate: string }).candidate)).toEqual(['c1', 'c2'])
    await peer.handleSignal({ type: 'ice-candidate', candidate: { ...CAND, candidate: 'c3' } })
    expect(pc().added).toHaveLength(3) // after the description, candidates go straight in
  })

  it('swallows a stale candidate instead of rejecting', async () => {
    const { peer, pc } = make()
    await peer.handleSignal({ type: 'offer', offer: OFFER })
    pc().failCandidates = true
    await expect(peer.handleSignal({ type: 'ice-candidate', candidate: CAND })).resolves.toBeUndefined()
  })

  it('ignores signals after close() and never signals again', async () => {
    const { peer, signals, pc } = make()
    peer.close()
    await peer.handleSignal({ type: 'offer', offer: OFFER })
    expect(pc().closed).toBe(true)
    expect(signals).toHaveLength(0)
  })

  it('reports failed if ICE never connects within connectTimeoutMs', () => {
    const { states } = make({ connectTimeoutMs: 20_000 })
    vi.advanceTimersByTime(19_999)
    expect(states).not.toContain('failed')
    vi.advanceTimersByTime(1)
    expect(states.at(-1)).toBe('failed')
  })

  it('maps ICE states: connected clears the timer, disconnected arms a 10s failure, failed is immediate', () => {
    const { states, pc } = make({ connectTimeoutMs: 20_000, failAfterMs: 10_000 })
    const setIce = (s: string) => {
      pc().iceConnectionState = s
      pc().oniceconnectionstatechange?.()
    }
    setIce('connected')
    expect(states.at(-1)).toBe('connected')
    vi.advanceTimersByTime(30_000)
    expect(states).not.toContain('failed') // connect timeout was cleared
    setIce('disconnected')
    expect(states.at(-1)).toBe('reconnecting')
    vi.advanceTimersByTime(10_000)
    expect(states.at(-1)).toBe('failed')
  })

  it('recovers from disconnected back to connected without failing', () => {
    const { states, pc } = make({ failAfterMs: 10_000 })
    const setIce = (s: string) => {
      pc().iceConnectionState = s
      pc().oniceconnectionstatechange?.()
    }
    setIce('connected')
    setIce('disconnected')
    vi.advanceTimersByTime(5_000)
    setIce('connected')
    vi.advanceTimersByTime(60_000)
    expect(states).not.toContain('failed')
    expect(states.at(-1)).toBe('connected')
  })

  it('sends text and binary only once the channel is open', () => {
    const { peer, pc } = make()
    expect(peer.sendText('x')).toBe(false)
    pc().channel.readyState = 'open'
    expect(peer.sendText('x')).toBe(true)
    expect(peer.sendBinary(new ArrayBuffer(2))).toBe(true)
    expect(pc().channel.sent).toHaveLength(2)
  })
})
