import type { RefObject } from 'react'
import { CameraFrame } from '../components/CameraFrame'
import type { PeerState } from '../lib/webrtc'

interface Props {
  stream: MediaStream | null
  mirrored: boolean
  remoteStream: MediaStream | null
  remoteMirrored: boolean
  peerState: PeerState
  localVideoRef: RefObject<HTMLVideoElement | null>
}

export function Stage({ stream, mirrored, remoteStream, remoteMirrored, peerState, localVideoRef }: Props) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-5xl flex-col gap-4 p-4">
      <p className="font-black">{peerState === 'connected' ? '● CONNECTED' : '● CONNECTING'}</p>
      <div className="grid gap-4 md:grid-cols-2">
        <CameraFrame stream={remoteStream} label="THEM" mirrored={remoteMirrored} testId="remote-video" />
        <CameraFrame stream={stream} label="YOU" mirrored={mirrored} testId="local-video" videoRef={localVideoRef} />
      </div>
    </main>
  )
}
