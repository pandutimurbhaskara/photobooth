import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router'
import { SYNC_BURST_READY } from '../../shared/constants'
import { defaultPlan, type PlanAction } from '../../shared/plan'
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
import { completeRound, finishedOf, highestReferenced, mergePhoto, missingRounds, pruneStore, putRound, type Finished, type Pending, type TakeStore } from '../lib/takes'
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

/** Stable reference for "no room-state yet", so effects keyed on the plan do not fire every render. */
const NO_PLAN = defaultPlan()

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
  const [store, setStore] = useState<TakeStore>(new Map())
  const highestSeen = useRef(-1) // the newest round any plan has mentioned: anything newer is a photo pair still waiting to be recorded
  const [partnerMirrored, setPartnerMirrored] = useState(true) // until the partner's `cam` message says otherwise
  const [captured, setCaptured] = useState(false)
  const [exchangeFailed, setExchangeFailed] = useState(false) // the data channel itself failed to deliver our photo
  const [roundFailed, setRoundFailed] = useState(false) // the round ended without both photos (a missed shot, a slow partner)
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

  const plan = room.state?.plan ?? NO_PLAN
  const sendToRoom = room.send
  const sendPlan = useCallback((action: PlanAction) => void sendToRoom({ type: 'plan', action }), [sendToRoom])
  // Keep only the photos the plan still needs; the store is the one place photos live.
  useEffect(() => {
    highestSeen.current = Math.max(highestSeen.current, highestReferenced(plan))
    setStore((s) => pruneStore(s, plan, highestSeen.current))
  }, [plan])

  // The finished strip is the one thing that cannot be recreated. Remember the last one, so it stays on screen
  // even if the partner starts over or retakes while you are still looking at it (spec §5).
  const live = useMemo(() => finishedOf(plan, store), [plan, store])
  const [snapshot, setSnapshot] = useState<Finished | null>(null)
  useEffect(() => {
    if (live) setSnapshot(live)
  }, [live])

  // A photo from either side lands here; when both halves of a round exist it is stored and reported.
  const addPhoto = useLatest((round: number, who: 'own' | 'partner', blob: Blob) => {
    if (round <= completed.current) return
    const merged = mergePhoto(pending.current, round, who, blob)
    pending.current = merged
    const done = slot.current ? completeRound(merged, slot.current) : null
    if (!done) return
    completed.current = round
    pending.current = null
    setStore((all) => putRound(all, done))
    room.send({ type: 'photo-complete', round })
  })
  const receiver = useMemo(
    () => new PhotoReceiver(() => currentRound.current, (round, blob) => addPhoto.current(round, 'partner', blob)),
    [addPhoto],
  )

  const rtc = useWebRTC({
    code,
    participantId,
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
    // The server repeats the current round in every room-state while it is in flight. A repeat must change
    // nothing — in particular it must not clear a MISSED IT that the first delivery just raised.
    if (round <= currentRound.current) return
    currentRound.current = round
    pending.current = null
    setMissed(false)
    setCaptured(false)
    setExchangeFailed(false)
    setRoundFailed(false)
    // May report "missed" synchronously when the message itself arrived far too late.
    const accepted = scheduler.schedule(round, captureAt, (r, at) => onCapture.current(r, at), () => setMissed(true))
    if (accepted) setCountdown({ round, captureAt })
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
    if (store.size === 0) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [store.size])

  const phase = room.state?.phase
  useEffect(() => {
    // The server gave up on the round (exchange timeout) while this side was still waiting for a photo. Say so
    // plainly and let both people go again — this is not necessarily a network failure.
    if (phase === 'ready' && pending.current !== null && pending.current.round === currentRound.current) {
      setRoundFailed(true)
    }
  }, [phase])

  if (gate === 'checking') return <Splash text="CHECKING BOOTH…" />
  if (gate === 'not-found') return <Problem kind="not-found" />
  if (gate === 'full') return <Problem kind="room-full" />
  if (gate === 'error') return <Problem kind="gate-error" onRetry={() => location.reload()} />

  const mySlot = room.state?.you
  const partner = room.state && mySlot ? room.state.participants[otherSlot(mySlot)] : null
  const me = room.state && mySlot ? room.state.participants[mySlot] : null
  const hasPhotos = store.size > 0
  const status: ConnKind =
    room.status === 'reconnecting'
      ? 'reconnecting'
      : room.status !== 'open'
        ? 'lost'
        : !partner?.connected
          ? 'waiting'
          : rtc.peerState === 'failed'
            ? 'lost'
            : rtc.peerState === 'connected'
              ? 'connected'
              : rtc.peerState === 'reconnecting'
                ? 'reconnecting'
                : 'connecting'
  const onReady = (ready: boolean) => {
    if (ready) sync.burst(SYNC_BURST_READY) // refresh the offset right before a round
    room.send({ type: ready ? 'ready' : 'unready' })
  }

  // A finished strip is the one thing that cannot be recreated and lives only in this tab. Never hide it behind a
  // failure screen (camera lost, socket closed, call dropped, partner gone): only a round in flight takes the screen back.
  const roundInFlight = room.status === 'open' && room.state?.phase === 'capture'
  const shown = live ?? snapshot
  if (shown && !roundInFlight) {
    const partnerChanged = !live // the plan moved on without us: say so, keep the strip
    return (
      <Result
        code={code}
        status={status}
        template={shown.template}
        cells={shown.cells}
        partnerHere={Boolean(partner?.connected)}
        canRetake={room.status === 'open' && Boolean(partner?.connected) && room.state?.phase === 'ready'}
        onRetake={(cell) => {
          setSnapshot(null)
          sendPlan({ k: 'retake', cell })
        }}
        notice={
          partnerChanged
            ? plan.stage === 'format'
              ? { text: 'THEY STARTED OVER. SAVE YOUR STRIP.', action: 'NEW STRIP', onAction: () => setSnapshot(null) }
              : { text: "THEY'RE RETAKING A CELL.", action: 'JOIN THEM', onAction: () => setSnapshot(null) }
            : undefined
        }
      />
    )
  }

  if (camera.error) return <Problem kind={cameraProblem[camera.error]} onRetry={() => void camera.start()} />
  if (!camera.stream) return <CameraGate onStart={() => void camera.start()} />

  if (room.status === 'closed') return <Problem kind={closedProblem(room.closeCode)} onRetry={room.reconnect} />
  if (!room.state) return <Splash text="CONNECTING…" />

  if (!partner?.connected) {
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
      canReady={sync.synced && rtc.peerState === 'connected' && rtc.channelOpen && (plan.stage !== 'format' || plan.template !== null)}
      onReady={onReady}
      countdown={countdown}
      now={sync.now}
      onCountdownDone={finishCountdown}
      missed={missed}
      roundFailed={roundFailed}
      exchanging={room.state.phase === 'capture' && countdown === null}
      captured={captured}
      plan={plan}
      store={store}
      mySlot={mySlot ?? null}
      canEdit={room.status === 'open' && room.state?.phase === 'ready'}
      onPlan={sendPlan}
      lostPhotos={plan.stage !== 'format' && missingRounds(plan, store).length > 0}
      onStartOver={() => {
        setSnapshot(null)
        sendPlan({ k: 'reset' })
      }}
    />
  )
}
