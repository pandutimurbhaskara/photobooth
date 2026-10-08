import { describe, expect, it } from 'vitest'
import { MAX_CANDIDATE_CHARS, MAX_SDP_CHARS, MAX_WS_FRAME_BYTES } from './constants'
import { decodeClientFrame, otherSlot, parseClientMessage } from './protocol'

const ID = 'participant-1-test'
const offer = { type: 'offer', sdp: 'v=0\r\n' }
const answer = { type: 'answer', sdp: 'v=0\r\n' }
const candidate = { candidate: 'candidate:1 1 udp 2122260223 10.0.0.2 54321 typ host', sdpMid: '0', sdpMLineIndex: 0 }

describe('parseClientMessage — accepts', () => {
  const ok: Array<[string, unknown]> = [
    ['join', { type: 'join', participantId: ID }],
    ['ready', { type: 'ready' }],
    ['unready', { type: 'unready' }],
    ['offer', { type: 'offer', offer }],
    ['answer', { type: 'answer', answer }],
    ['ice-candidate', { type: 'ice-candidate', candidate }],
    ['ice-candidate with null fields', { type: 'ice-candidate', candidate: { candidate: '', sdpMid: null, sdpMLineIndex: null, usernameFragment: null } }],
    ['photo-complete', { type: 'photo-complete', round: 2 }],
    ['ping', { type: 'ping', clientTime: 1_700_000_000_000 }],
  ]
  it.each(ok)('%s', (_name, raw) => {
    expect(parseClientMessage(raw)).toEqual(raw)
  })
})

describe('parseClientMessage — rejects', () => {
  const bad: Array<[string, unknown]> = [
    ['not an object', 'ready'],
    ['array', []],
    ['null', null],
    ['no type', {}],
    ['unknown type', { type: 'schedule-capture' }],
    ['join without id', { type: 'join' }],
    ['join id too short', { type: 'join', participantId: 'abc' }],
    ['join id with bad chars', { type: 'join', participantId: 'participant 1 test!' }],
    ['ready with extra key', { type: 'ready', extra: 1 }],
    ['offer typed answer', { type: 'offer', offer: answer }],
    ['offer with empty sdp', { type: 'offer', offer: { type: 'offer', sdp: '' } }],
    ['offer sdp too large', { type: 'offer', offer: { type: 'offer', sdp: 'x'.repeat(MAX_SDP_CHARS + 1) } }],
    ['offer extra key', { type: 'offer', offer: { type: 'offer', sdp: 'v=0', rollback: true } }],
    ['candidate too large', { type: 'ice-candidate', candidate: { candidate: 'x'.repeat(MAX_CANDIDATE_CHARS + 1) } }],
    ['candidate bad index', { type: 'ice-candidate', candidate: { candidate: 'c', sdpMLineIndex: -1 } }],
    ['candidate fractional index', { type: 'ice-candidate', candidate: { candidate: 'c', sdpMLineIndex: 1.5 } }],
    ['candidate bad mid', { type: 'ice-candidate', candidate: { candidate: 'c', sdpMid: 7 } }],
    ['photo-complete negative', { type: 'photo-complete', round: -1 }],
    ['photo-complete fractional', { type: 'photo-complete', round: 1.5 }],
    ['photo-complete string', { type: 'photo-complete', round: '1' }],
    ['ping NaN', { type: 'ping', clientTime: Number.NaN }],
    ['ping string', { type: 'ping', clientTime: '1' }],
  ]
  it.each(bad)('%s', (_name, raw) => {
    expect(parseClientMessage(raw)).toBeNull()
  })
})

describe('decodeClientFrame', () => {
  it('parses a JSON text frame', () => {
    expect(decodeClientFrame(JSON.stringify({ type: 'ready' }))).toEqual({ type: 'ready' })
  })
  it('rejects binary, oversize and malformed frames', () => {
    expect(decodeClientFrame(new ArrayBuffer(4))).toBeNull()
    expect(decodeClientFrame('x'.repeat(MAX_WS_FRAME_BYTES + 1))).toBeNull()
    expect(decodeClientFrame('{not json')).toBeNull()
    expect(decodeClientFrame('')).toBeNull()
  })
  it('rejects an own "__proto__" key (prototype-pollution shaped payload)', () => {
    expect(decodeClientFrame(`{"type":"join","participantId":"${ID}","__proto__":{"x":1}}`)).toBeNull()
  })
})

describe('otherSlot', () => {
  it('flips a and b', () => {
    expect(otherSlot('a')).toBe('b')
    expect(otherSlot('b')).toBe('a')
  })
})

describe('parseClientMessage — plan', () => {
  const accepted = [
    { type: 'plan', action: { k: 'template', template: 'duo2' } },
    { type: 'plan', action: { k: 'kind', cell: 1, kind: 'a' } },
    { type: 'plan', action: { k: 'keep', round: 3 } },
    { type: 'plan', action: { k: 'more' } },
    { type: 'plan', action: { k: 'retake', cell: 0 } },
    { type: 'plan', action: { k: 'reset' } },
  ]
  it.each(accepted)('accepts %j', (raw) => {
    expect(parseClientMessage(raw)).toEqual(raw)
  })

  const rejected: Array<[string, unknown]> = [
    ['no action', { type: 'plan' }],
    ['unknown action', { type: 'plan', action: { k: 'explode' } }],
    ['unknown template', { type: 'plan', action: { k: 'template', template: 'horizontal' } }],
    ['extra key beside action', { type: 'plan', action: { k: 'reset' }, extra: 1 }],
    ['extra key inside action', { type: 'plan', action: { k: 'reset', extra: 1 } }],
    ['action is a string', { type: 'plan', action: 'reset' }],
  ]
  it.each(rejected)('rejects %s', (_name, raw) => {
    expect(parseClientMessage(raw)).toBeNull()
  })
})
