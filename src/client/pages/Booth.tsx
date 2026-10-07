import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router'
import { SYNC_BURST_READY } from '../../shared/constants'
import { otherSlot, type ServerMessage, type SlotName } from '../../shared/protocol'
import { normalizeRoomInput } from '../../shared/room-code'
import type { ConnKind } from '../components/ConnectionStatus'
import { useCamera } from '../hooks/useCamera'
import { useLatest } from '../hooks/useLatest'
import { useRoom } from '../hooks/useRoom'
import { useRoomGate } from '../hooks/useRoomGate'
import { useSyncClock } from '../hooks/useSyncClock'
import { useWebRTC } from '../hooks/useWebRTC'
import type { CameraError } from '../lib/camera'
import { browserCaptureDeps, createCaptureScheduler } from '../lib/capture'
import { recordCapture } from '../lib/dev-hook'
import { captureFrame, FrameNotReadyError } from '../lib/photo'
import { parseControl, PhotoReceiver, sendPhoto } from '../lib/photo-transfer'
import { completeRound, mergePhoto, pushRound, type Pending, type Round } from '../lib/rounds'
import { getParticipantId } from '../lib/session'
import { CameraGate } from '../screens/CameraGate'
import { Lobby } from '../screens/Lobby'
import { Problem, type ProblemKind } from '../screens/Problem'
import { Result } from '../screens/Result'
import { Splash } from '../screens/Splash'
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
  const [rounds, setRounds] = useState<Round[]>([])
  const [partnerMirrored, setPartnerMirrored] = useState(true) // until the partner's `cam` message says otherwise
  const [captured, setCaptured] = useState(false)
  const [exchangeFailed, setExchangeFailed] = useState(false)
  const pending = useRef<Pending | null>(null)
  const completed = useRef(-1) // highest round already finished: later duplicates are ignored
  const currentRound = useRef(0) // the round the server most recently announced

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

  // A photo from either side lands here; when both halves of a round exist it is stored and reported.
  const addPhoto = useLatest((round: number, who: 'own' | 'partner', blob: Blob) => {
    if (round <= completed.current) return
    const merged = mergePhoto(pending.current, round, who, blob)
    pending.current = merged
    const done = slot.current ? completeRound(merged, slot.current) : null
    if (!done) return
    completed.current = round
    pending.current = null
    setRounds((all) => pushRound(all, done))
    room.send({ type: 'photo-complete', round })
  })
  const receiver = useMemo(
    () => new PhotoReceiver(() => currentRound.current, (round, blob) => addPhoto.current(round, 'partner', blob)),
    [addPhoto],
  )

  const rtc = useWebRTC({
    code,
    send: room.send,
    localStream: camera.stream,
    onChannelText: (text) => {
      const control = parseControl(text)
      if (!control) return
      if (control.t === 'cam') setPartnerMirrored(control.mirrored)
      else receiver.onControl(control)
    },
    onChannelBinary: (data) => receiver.onBinary(data),
  })
  const sync = useSyncClock(room.send, room.status === 'open')
  const scheduler = useMemo(() => createCaptureScheduler(browserCaptureDeps(sync.now)), [sync.now])

  const onCapture = useLatest((round: number, at: number) => {
    const wallAt = Date.now() // the moment the shared timestamp fired on this device
    const video = localVideo.current
    const mirrored = camera.mirrored
    void (async () => {
      try {
        if (!video) throw new FrameNotReadyError()
        const blob = await captureFrame(video, { mirrored })
        recordCapture({ round, at, wallAt, mirrored })
        setCaptured(true)
        addPhoto.current(round, 'own', blob)
        const channel = { sendText: rtc.sendText, sendBinary: rtc.sendBinary, waitForDrain: rtc.waitForDrain }
        if (!(await sendPhoto(channel, round, blob))) setExchangeFailed(true)
      } catch {
        setMissed(true) // no frame yet, or the encoder failed: say so rather than sending nothing silently
      }
    })()
  })
  const beginRound = useLatest((round: number, captureAt: number) => {
    setMissed(false)
    const accepted = scheduler.schedule(round, captureAt, (r, at) => onCapture.current(r, at), () => setMissed(true))
    if (!accepted) return
    currentRound.current = round
    pending.current = null
    setCaptured(false)
    setExchangeFailed(false)
    setCountdown({ round, captureAt })
  })
  const finishCountdown = useCallback(() => setCountdown(null), [])

  // Tell the partner whether our preview (and so our photo) is mirrored, so their THEM frame matches our photo.
  const { sendText, channelOpen } = rtc
  useEffect(() => {
    if (channelOpen) sendText(JSON.stringify({ t: 'cam', mirrored: camera.mirrored }))
  }, [channelOpen, sendText, camera.mirrored])

  // Remember that someone was here, so the lobby can say they left.
  const partnerConnected = room.state ? Boolean(room.state.participants[otherSlot(room.state.you)]?.connected) : false
  const [hadPartner, setHadPartner] = useState(false)
  useEffect(() => {
    if (partnerConnected) setHadPartner(true)
  }, [partnerConnected])

  // Photos live only in this tab, so warn before a reload or close throws them away.
  useEffect(() => {
    if (rounds.length === 0) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [rounds.length])

  const phase = room.state?.phase
  useEffect(() => {
    // The server gave up on the round (exchange timeout) while this side still lacked a photo.
    if (phase === 'ready' && pending.current !== null && pending.current.round === currentRound.current) {
      setExchangeFailed(true)
    }
  }, [phase])

  if (gate === 'checking') return <Splash text="CHECKING BOOTH…" />
  if (gate === 'not-found') return <Problem kind="not-found" />
  if (gate === 'full') return <Problem kind="room-full" />
  if (gate === 'error') return <Problem kind="gate-error" onRetry={() => location.reload()} />

  if (camera.error) return <Problem kind={cameraProblem[camera.error]} onRetry={() => void camera.start()} />
  if (!camera.stream) return <CameraGate onStart={() => void camera.start()} />

  if (room.status === 'closed') return <Problem kind={closedProblem(room.closeCode)} onRetry={room.reconnect} />
  if (!room.state) return <Splash text="CONNECTING…" />

  const mySlot = room.state.you
  const partner = room.state.participants[otherSlot(mySlot)]
  const me = room.state.participants[mySlot]
  const latest = rounds[rounds.length - 1]
  const hasResult = latest !== undefined && room.state.phase !== 'capture'
  const hasPhotos = rounds.length > 0
  const status: ConnKind =
    room.status === 'reconnecting'
      ? 'reconnecting'
      : room.status !== 'open'
        ? 'lost'
        : !partner?.connected
          ? 'waiting'
          : rtc.peerState === 'connected'
            ? 'connected'
            : rtc.peerState === 'reconnecting'
              ? 'reconnecting'
              : 'connecting'
  const onReady = (ready: boolean) => {
    if (ready) sync.burst(SYNC_BURST_READY) // refresh the offset right before a round
    room.send({ type: ready ? 'ready' : 'unready' })
  }

  if (!partner?.connected && !hasResult) {
    return (
      <Lobby
        code={code}
        shareUrl={`${location.origin}/b/${code}`}
        status={status}
        hasPhotos={hasPhotos}
        stream={camera.stream}
        mirrored={camera.mirrored}
        canFlip={camera.canFlip}
        onFlip={() => void camera.flip()}
        partnerLeft={hadPartner}
      />
    )
  }
  if (rtc.peerState === 'failed' || exchangeFailed) {
    return (
      <Problem
        kind="webrtc-failed"
        onRetry={() => {
          setExchangeFailed(false)
          room.reconnect()
        }}
      />
    )
  }
  if (hasResult) {
    return (
      <Result
        rounds={rounds}
        code={code}
        me={me}
        partner={partner}
        partnerHere={Boolean(partner?.connected)}
        canRetake={Boolean(partner?.connected) && room.state.phase === 'ready' && sync.synced && rtc.channelOpen}
        onReady={onReady}
      />
    )
  }
  return (
    <Stage
      code={code}
      status={status}
      hasPhotos={hasPhotos}
      canFlip={camera.canFlip}
      onFlip={() => void camera.flip()}
      stream={camera.stream}
      mirrored={camera.mirrored}
      remoteStream={rtc.remoteStream}
      remoteMirrored={partnerMirrored}
      localVideoRef={localVideo}
      me={me}
      partner={partner}
      canReady={sync.synced && rtc.peerState === 'connected' && rtc.channelOpen}
      onReady={onReady}
      countdown={countdown}
      now={sync.now}
      onCountdownDone={finishCountdown}
      missed={missed}
      exchanging={room.state.phase === 'capture' && countdown === null}
      captured={captured}
    />
  )
}
