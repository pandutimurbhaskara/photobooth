import { MAX_CANDIDATE_CHARS, MAX_SDP_CHARS, MAX_WS_FRAME_BYTES } from './constants'
import { parsePlanAction, type Plan, type PlanAction } from './plan'

export type SlotName = 'a' | 'b'
export const otherSlot = (slot: SlotName): SlotName => (slot === 'a' ? 'b' : 'a')

export const PARTICIPANT_ID_RE = /^[A-Za-z0-9-]{8,64}$/

// Structural twins of the DOM RTC types, so this file compiles in the Worker (no DOM lib)
// and is assignable to the browser's RTCSessionDescriptionInit / RTCIceCandidateInit.
export interface OfferInit {
  type: 'offer'
  sdp: string
}
export interface AnswerInit {
  type: 'answer'
  sdp: string
}
export interface IceCandidateInit {
  candidate: string
  sdpMid?: string | null
  sdpMLineIndex?: number | null
  usernameFragment?: string | null
}
export interface IceServerConfig {
  urls: string | string[]
  username?: string
  credential?: string
}

export type Phase = 'waiting' | 'ready' | 'capture'
export interface PState {
  connected: boolean
  ready: boolean
  photoDone: boolean
}
export interface RoomState {
  code: string
  you: SlotName
  phase: Phase
  round: number
  captureAt: number | null
  participants: Record<SlotName, PState | null>
  plan: Plan
}
export type ErrorCode =
  | 'invalid-message'
  | 'not-joined'
  | 'room-full'
  | 'room-not-found'
  | 'rate-limited'
  | 'expired'

export type ClientMessage =
  | { type: 'join'; participantId: string }
  | { type: 'ready' }
  | { type: 'unready' }
  | { type: 'offer'; offer: OfferInit }
  | { type: 'answer'; answer: AnswerInit }
  | { type: 'ice-candidate'; candidate: IceCandidateInit }
  | { type: 'photo-complete'; round: number }
  | { type: 'plan'; action: PlanAction }
  | { type: 'ping'; clientTime: number }

export type ServerMessage =
  | { type: 'room-state'; state: RoomState }
  | { type: 'partner-joined' }
  | { type: 'partner-left' }
  | { type: 'offer'; offer: OfferInit }
  | { type: 'answer'; answer: AnswerInit }
  | { type: 'ice-candidate'; candidate: IceCandidateInit }
  | { type: 'capture-scheduled'; captureAt: number; round: number }
  | { type: 'pong'; clientTime: number; serverTime: number }
  | { type: 'error'; code: ErrorCode }

type Rec = Record<string, unknown>
const isRec = (x: unknown): x is Rec => typeof x === 'object' && x !== null && !Array.isArray(x)
const onlyKeys = (o: Rec, keys: readonly string[]): boolean => Object.keys(o).every((k) => keys.includes(k))
const isRound = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 1_000_000
const isOptStr = (v: unknown): v is string | null | undefined =>
  v === undefined || v === null || (typeof v === 'string' && v.length <= 256)
const isOptIdx = (v: unknown): v is number | null | undefined =>
  v === undefined || v === null || (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 64)

function sdp<T extends 'offer' | 'answer'>(v: unknown, type: T): { type: T; sdp: string } | null {
  if (!isRec(v) || !onlyKeys(v, ['type', 'sdp'])) return null
  const body = v.sdp
  if (v.type !== type || typeof body !== 'string' || body.length === 0 || body.length > MAX_SDP_CHARS) return null
  return { type, sdp: body }
}

function candidate(v: unknown): IceCandidateInit | null {
  if (!isRec(v) || !onlyKeys(v, ['candidate', 'sdpMid', 'sdpMLineIndex', 'usernameFragment'])) return null
  const { candidate: text, sdpMid, sdpMLineIndex, usernameFragment } = v
  if (typeof text !== 'string' || text.length > MAX_CANDIDATE_CHARS) return null
  if (!isOptStr(sdpMid) || !isOptIdx(sdpMLineIndex) || !isOptStr(usernameFragment)) return null
  const out: IceCandidateInit = { candidate: text }
  if (sdpMid !== undefined) out.sdpMid = sdpMid
  if (sdpMLineIndex !== undefined) out.sdpMLineIndex = sdpMLineIndex
  if (usernameFragment !== undefined) out.usernameFragment = usernameFragment
  return out
}

export function parseClientMessage(raw: unknown): ClientMessage | null {
  if (!isRec(raw) || typeof raw.type !== 'string') return null
  switch (raw.type) {
    case 'join':
      return onlyKeys(raw, ['type', 'participantId']) &&
        typeof raw.participantId === 'string' &&
        PARTICIPANT_ID_RE.test(raw.participantId)
        ? { type: 'join', participantId: raw.participantId }
        : null
    case 'ready':
      return onlyKeys(raw, ['type']) ? { type: 'ready' } : null
    case 'unready':
      return onlyKeys(raw, ['type']) ? { type: 'unready' } : null
    case 'offer': {
      const offer = onlyKeys(raw, ['type', 'offer']) ? sdp(raw.offer, 'offer') : null
      return offer ? { type: 'offer', offer } : null
    }
    case 'answer': {
      const answer = onlyKeys(raw, ['type', 'answer']) ? sdp(raw.answer, 'answer') : null
      return answer ? { type: 'answer', answer } : null
    }
    case 'ice-candidate': {
      const c = onlyKeys(raw, ['type', 'candidate']) ? candidate(raw.candidate) : null
      return c ? { type: 'ice-candidate', candidate: c } : null
    }
    case 'photo-complete':
      return onlyKeys(raw, ['type', 'round']) && isRound(raw.round)
        ? { type: 'photo-complete', round: raw.round }
        : null
    case 'plan': {
      const action = onlyKeys(raw, ['type', 'action']) ? parsePlanAction(raw.action) : null
      return action ? { type: 'plan', action } : null
    }
    case 'ping':
      return onlyKeys(raw, ['type', 'clientTime']) &&
        typeof raw.clientTime === 'number' &&
        Number.isFinite(raw.clientTime)
        ? { type: 'ping', clientTime: raw.clientTime }
        : null
    default:
      return null
  }
}

export function decodeClientFrame(data: unknown): ClientMessage | null {
  if (typeof data !== 'string' || data.length > MAX_WS_FRAME_BYTES) return null
  try {
    return parseClientMessage(JSON.parse(data))
  } catch {
    return null
  }
}
