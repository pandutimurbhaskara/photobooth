import { useCallback, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router'
import { SYNC_BURST_READY } from '../../shared/constants'
import { otherSlot, type ServerMessage, type SlotName } from '../../shared/protocol'
import { normalizeRoomInput } from '../../shared/room-code'
import { useCamera } from '../hooks/useCamera'
import { useLatest } from '../hooks/useLatest'
import { useRoom } from '../hooks/useRoom'
import { useRoomGate } from '../hooks/useRoomGate'
import { useSyncClock } from '../hooks/useSyncClock'
import { useWebRTC } from '../hooks/useWebRTC'
import type { CameraError } from '../lib/camera'
import { browserCaptureDeps, createCaptureScheduler } from '../lib/capture'
import { recordCapture } from '../lib/dev-hook'
import { getParticipantId } from '../lib/session'
import { CameraGate } from '../screens/CameraGate'
import { Lobby } from '../screens/Lobby'
import { Problem, type ProblemKind } from '../screens/Problem'
import { Stage } from '../screens/Stage'

const cameraProblem: Record<CameraError, ProblemKind> = {
  blocked: 'camera-blocked',
  unavailable: 'camera-unavailable',
  unsupported: 'camera-unsupported',
}

function closedProblem(code: number | null): ProblemKind {
  switch (code) {
    case 4403:
      return 'room-full'
    case 4404:
      return 'not-found'
    case 4000:
      return 'expired'
    case 4001:
      return 'replaced'
    default:
      return 'connection-lost'
  }
}

export function Booth() {
  const { code: raw } = useParams()
  const code = normalizeRoomInput(raw ?? '')
  return code ? <BoothInner code={code} /> : <Problem kind="not-found" />
}

function BoothInner({ code }: { code: string }) {
  const participantId = useMemo(() => getParticipantId(code), [code])
  const gate = useRoomGate(code, participantId)
  const camera = useCamera()
  const localVideo = useRef<HTMLVideoElement | null>(null)
  const slot = useRef<SlotName | null>(null)
  const [countdown, setCountdown] = useState<{ round: number; captureAt: number } | null>(null)
  const [missed, setMissed] = useState(false)

  // Server events → WebRTC and the capture scheduler. `latest` keeps this closure fresh without reconnecting the socket.
  const onMessage = useLatest((m: ServerMessage, isSnapshot: boolean) => {
    switch (m.type) {
      case 'room-state':
        slot.current = m.state.you
        // Slot a re-offers when it joins a booth where b is already present (b never offers).
        if (isSnapshot && m.state.you === 'a' && m.state.participants.b?.connected) rtc.buildAndOffer()
        // A reload or reconnect mid-round: the room-state carries the round, and the scheduler dedupes repeats.
        if (m.state.phase === 'capture' && m.state.captureAt !== null) beginRound.current(m.state.round, m.state.captureAt)
        return
      case 'partner-joined':
        if (slot.current === 'a') rtc.buildAndOffer()
        else rtc.closePeer() // b waits for a's offer and rebuilds on it
        return
      case 'partner-left':
        scheduler.cancel()
        setCountdown(null)
        rtc.closePeer()
        return
      case 'offer':
      case 'answer':
      case 'ice-candidate':
        rtc.onSignal(m)
        return
      case 'pong':
        sync.onPong(m)
        return
      case 'capture-scheduled':
        beginRound.current(m.round, m.captureAt)
        return
      default:
        return
    }
  })

  const room = useRoom({
    code,
    participantId,
    enabled: gate === 'ok' && camera.stream !== null,
    onMessage: (m, isSnapshot) => onMessage.current(m, isSnapshot),
  })
  const rtc = useWebRTC({
    code,
    send: room.send,
    localStream: camera.stream,
    onChannelText: () => {},
    onChannelBinary: () => {},
  })
  const sync = useSyncClock(room.send, room.status === 'open')
  const scheduler = useMemo(() => createCaptureScheduler(browserCaptureDeps(sync.now)), [sync.now])

  // Phase 2: "capture" just records the moment; Task 18 replaces the body with a real frame grab.
  const onCapture = useLatest((round: number, at: number) => {
    recordCapture({ round, at, wallAt: Date.now(), mirrored: camera.mirrored })
    room.send({ type: 'photo-complete', round }) // Phase 2 stand-in: no photo to exchange yet
  })
  const beginRound = useLatest((round: number, captureAt: number) => {
    setMissed(false)
    const accepted = scheduler.schedule(round, captureAt, (r, at) => onCapture.current(r, at), () => setMissed(true))
    if (accepted) setCountdown({ round, captureAt })
  })
  const finishCountdown = useCallback(() => setCountdown(null), [])

  if (gate === 'checking') return <main className="p-6 font-black">CHECKING BOOTH…</main>
  if (gate === 'not-found') return <Problem kind="not-found" />
  if (gate === 'full') return <Problem kind="room-full" />
  if (gate === 'error') return <Problem kind="gate-error" onRetry={() => location.reload()} />

  if (camera.error) return <Problem kind={cameraProblem[camera.error]} onRetry={() => void camera.start()} />
  if (!camera.stream) return <CameraGate onStart={() => void camera.start()} />

  if (room.status === 'closed') return <Problem kind={closedProblem(room.closeCode)} onRetry={room.reconnect} />
  if (!room.state) return <main className="p-6 font-black">CONNECTING…</main>

  const partner = room.state.participants[otherSlot(room.state.you)]
  if (!partner?.connected) {
    return <Lobby code={code} shareUrl={`${location.origin}/b/${code}`} stream={camera.stream} mirrored={camera.mirrored} />
  }
  if (rtc.peerState === 'failed') return <Problem kind="webrtc-failed" onRetry={room.reconnect} />

  const me = room.state.participants[room.state.you]
  return (
    <Stage
      stream={camera.stream}
      mirrored={camera.mirrored}
      remoteStream={rtc.remoteStream}
      remoteMirrored
      peerState={rtc.peerState}
      localVideoRef={localVideo}
      me={me}
      partner={partner}
      canReady={sync.synced && rtc.peerState === 'connected' && rtc.channelOpen}
      onReady={(ready) => {
        if (ready) sync.burst(SYNC_BURST_READY) // refresh the offset right before a round
        room.send({ type: ready ? 'ready' : 'unready' })
      }}
      countdown={countdown}
      now={sync.now}
      onCountdownDone={finishCountdown}
      missed={missed}
    />
  )
}
