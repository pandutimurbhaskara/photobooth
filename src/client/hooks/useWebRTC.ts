import { useCallback, useEffect, useRef, useState } from 'react'
import { DEFAULT_STUN } from '../../shared/constants'
import type { ClientMessage, IceServerConfig } from '../../shared/protocol'
import { Peer, type PeerState, type SignalIn } from '../lib/webrtc'
import { useLatest } from './useLatest'

interface Args {
  code: string
  send: (message: ClientMessage) => boolean
  localStream: MediaStream | null
  onChannelText: (text: string) => void
  onChannelBinary: (data: ArrayBuffer) => void
}

async function fetchIceServers(code: string): Promise<IceServerConfig[]> {
  try {
    const res = await fetch(`/api/ice?room=${code}`)
    if (res.ok) return ((await res.json()) as { iceServers: IceServerConfig[] }).iceServers
  } catch {
    // fall through to the public default
  }
  return [{ urls: DEFAULT_STUN }]
}

export function useWebRTC(args: Args) {
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null)
  const [peerState, setPeerState] = useState<PeerState>('closed')
  const [channelOpen, setChannelOpen] = useState(false)
  const peerRef = useRef<Peer | null>(null)
  const generation = useRef(0)
  const chain = useRef<Promise<void>>(Promise.resolve())
  const latest = useLatest(args)

  const closePeer = useCallback(() => {
    generation.current += 1 // invalidates any build still waiting on the network
    peerRef.current?.close()
    peerRef.current = null
    setRemoteStream(null)
    setPeerState('closed')
    setChannelOpen(false)
  }, [])

  const build = useCallback(
    async (offer: boolean) => {
      closePeer()
      const gen = generation.current
      const a = latest.current
      if (!a.localStream) return
      const iceServers = await fetchIceServers(a.code)
      if (gen !== generation.current) return // superseded while fetching
      const peer = new Peer({
        iceServers,
        localStream: a.localStream,
        signal: (m) => void latest.current.send(m),
        onRemoteStream: (s) => {
          if (gen === generation.current) setRemoteStream(s)
        },
        onState: (s) => {
          if (gen === generation.current) setPeerState(s)
        },
        onChannelOpen: () => {
          if (gen === generation.current) setChannelOpen(true)
        },
        onChannelText: (t) => latest.current.onChannelText(t),
        onChannelBinary: (b) => latest.current.onChannelBinary(b),
      })
      peerRef.current = peer
      if (offer) await peer.start()
    },
    [closePeer, latest],
  )

  /** Signals are handled strictly in order: an offer's build must finish before its candidates arrive. */
  const enqueue = useCallback((job: () => Promise<void>) => {
    chain.current = chain.current.then(job).catch(() => setPeerState('failed'))
  }, [])

  const buildAndOffer = useCallback(() => enqueue(() => build(true)), [build, enqueue])

  const onSignal = useCallback(
    (m: SignalIn) =>
      enqueue(async () => {
        if (m.type === 'offer') await build(false)
        await peerRef.current?.handleSignal(m)
      }),
    [build, enqueue],
  )

  // Swap the outgoing video track in place when the camera is flipped (no renegotiation).
  const localStream = args.localStream
  useEffect(() => {
    const track = localStream?.getVideoTracks()[0]
    if (track) void peerRef.current?.replaceVideoTrack(track)
  }, [localStream])

  useEffect(() => closePeer, [closePeer])

  return {
    remoteStream,
    peerState,
    channelOpen,
    buildAndOffer,
    onSignal,
    closePeer,
    sendText: useCallback((s: string) => peerRef.current?.sendText(s) ?? false, []),
    sendBinary: useCallback((b: ArrayBuffer) => peerRef.current?.sendBinary(b) ?? false, []),
    waitForDrain: useCallback(() => peerRef.current?.waitForDrain() ?? Promise.resolve(), []),
  }
}
