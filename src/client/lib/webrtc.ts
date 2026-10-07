import type { ClientMessage, IceCandidateInit, IceServerConfig, ServerMessage } from '../../shared/protocol'

export type PeerState = 'connecting' | 'connected' | 'reconnecting' | 'failed' | 'closed'
export type SignalOut = Extract<ClientMessage, { type: 'offer' | 'answer' | 'ice-candidate' }>
export type SignalIn = Extract<ServerMessage, { type: 'offer' | 'answer' | 'ice-candidate' }>

export interface PeerOptions {
  iceServers: IceServerConfig[]
  localStream: MediaStream | null
  signal: (message: SignalOut) => void
  onRemoteStream: (stream: MediaStream) => void
  onState: (state: PeerState) => void
  onChannelOpen: () => void
  onChannelText: (text: string) => void
  onChannelBinary: (data: ArrayBuffer) => void
  PeerConnectionImpl?: typeof RTCPeerConnection
  /** How long a `disconnected` connection may take to recover before we call it failed. */
  failAfterMs?: number
  /** How long the first connection may take before we call it failed. */
  connectTimeoutMs?: number
}

const LOW_WATER = 256 * 1024

/**
 * One RTCPeerConnection plus the photo DataChannel. Slot `a` calls `start()` (offer); slot `b` just
 * feeds `handleSignal()`. There is no renegotiation: a failure is handled by building a new Peer.
 */
export class Peer {
  private readonly pc: RTCPeerConnection
  private readonly channel: RTCDataChannel
  private pending: IceCandidateInit[] = []
  private failTimer: ReturnType<typeof setTimeout> | null = null
  private closed = false

  constructor(private readonly o: PeerOptions) {
    const Impl = o.PeerConnectionImpl ?? RTCPeerConnection
    this.pc = new Impl({ iceServers: o.iceServers })

    this.channel = this.pc.createDataChannel('photos', { negotiated: true, id: 0, ordered: true })
    this.channel.binaryType = 'arraybuffer'
    this.channel.bufferedAmountLowThreshold = LOW_WATER
    this.channel.onopen = () => o.onChannelOpen()
    this.channel.onmessage = (e: MessageEvent) => {
      if (typeof e.data === 'string') o.onChannelText(e.data)
      else o.onChannelBinary(e.data as ArrayBuffer)
    }

    const local = o.localStream
    if (local) for (const track of local.getTracks()) this.pc.addTrack(track, local)

    this.pc.ontrack = (e) => {
      const stream = e.streams[0]
      if (stream) o.onRemoteStream(stream)
    }
    this.pc.onicecandidate = (e) => {
      if (e.candidate && !this.closed) {
        const c = e.candidate
        o.signal({
          type: 'ice-candidate',
          candidate: { candidate: c.candidate, sdpMid: c.sdpMid, sdpMLineIndex: c.sdpMLineIndex, usernameFragment: c.usernameFragment },
        })
      }
    }
    this.pc.oniceconnectionstatechange = () => this.onIce()

    o.onState('connecting')
    this.armFail(o.connectTimeoutMs ?? 20_000)
  }

  async start(): Promise<void> {
    const offer = await this.pc.createOffer()
    await this.pc.setLocalDescription(offer)
    const d = this.pc.localDescription
    if (d?.sdp && !this.closed) this.o.signal({ type: 'offer', offer: { type: 'offer', sdp: d.sdp } })
  }

  async handleSignal(m: SignalIn): Promise<void> {
    if (this.closed) return
    switch (m.type) {
      case 'offer': {
        await this.pc.setRemoteDescription(m.offer)
        await this.flush()
        await this.pc.setLocalDescription()
        const d = this.pc.localDescription
        if (d?.sdp && !this.closed) this.o.signal({ type: 'answer', answer: { type: 'answer', sdp: d.sdp } })
        return
      }
      case 'answer':
        await this.pc.setRemoteDescription(m.answer)
        await this.flush()
        return
      case 'ice-candidate':
        if (this.pc.remoteDescription) await this.add(m.candidate)
        else this.pending.push(m.candidate)
        return
    }
  }

  async replaceVideoTrack(track: MediaStreamTrack): Promise<void> {
    const sender = this.pc.getSenders().find((s) => s.track === null || s.track.kind === 'video')
    await sender?.replaceTrack(track)
  }

  sendText(text: string): boolean {
    if (this.channel.readyState !== 'open') return false
    this.channel.send(text)
    return true
  }

  sendBinary(data: ArrayBuffer): boolean {
    if (this.channel.readyState !== 'open') return false
    this.channel.send(data)
    return true
  }

  /** Resolves immediately when the send buffer is below the low-water mark, else when it drains to it. */
  waitForDrain(): Promise<void> {
    if (this.channel.bufferedAmount <= this.channel.bufferedAmountLowThreshold) return Promise.resolve()
    return new Promise((resolve) => {
      this.channel.onbufferedamountlow = () => {
        this.channel.onbufferedamountlow = null
        resolve()
      }
    })
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.clearFail()
    this.pc.onicecandidate = null
    this.pc.ontrack = null
    this.pc.oniceconnectionstatechange = null
    this.channel.onmessage = null
    try {
      this.channel.close()
    } catch {
      // already closed
    }
    this.pc.close()
  }

  private async flush(): Promise<void> {
    for (const candidate of this.pending.splice(0)) await this.add(candidate)
  }

  private async add(candidate: IceCandidateInit): Promise<void> {
    try {
      await this.pc.addIceCandidate(candidate)
    } catch {
      // a candidate from a connection we already replaced; harmless
    }
  }

  private onIce(): void {
    if (this.closed) return
    switch (this.pc.iceConnectionState) {
      case 'connected':
      case 'completed':
        this.clearFail()
        this.o.onState('connected')
        return
      case 'disconnected':
        this.o.onState('reconnecting')
        this.armFail(this.o.failAfterMs ?? 10_000)
        return
      case 'failed':
        this.clearFail()
        this.o.onState('failed')
        return
      default:
        return
    }
  }

  private armFail(ms: number): void {
    if (this.failTimer !== null) return
    this.failTimer = setTimeout(() => {
      this.failTimer = null
      if (!this.closed) this.o.onState('failed')
    }, ms)
  }

  private clearFail(): void {
    if (this.failTimer !== null) clearTimeout(this.failTimer)
    this.failTimer = null
  }
}
