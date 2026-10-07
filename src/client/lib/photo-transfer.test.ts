import { describe, expect, it } from 'vitest'
import { PHOTO_MAX_BYTES } from '../../shared/constants'
import { chunks, parseControl, PhotoReceiver, sendPhoto, type PhotoChannel } from './photo-transfer'

function setup(expectedRound = 1) {
  const got: Array<{ round: number; blob: Blob }> = []
  const rejects: string[] = []
  const receiver = new PhotoReceiver(
    () => expectedRound,
    (round, blob) => got.push({ round, blob }),
    (reason) => rejects.push(reason),
  )
  const text = (s: string) => {
    const c = parseControl(s)
    if (c) receiver.onControl(c)
  }
  return { receiver, got, rejects, text }
}
const header = (round: number, size: number) => JSON.stringify({ t: 'photo', round, mime: 'image/jpeg', size })
const end = (round: number) => JSON.stringify({ t: 'end', round })
const bytes = (n: number) => new Uint8Array(n).fill(7).buffer

describe('parseControl', () => {
  it('accepts the three control messages', () => {
    expect(parseControl('{"t":"cam","mirrored":false}')).toEqual({ t: 'cam', mirrored: false })
    expect(parseControl(header(2, 10))).toEqual({ t: 'photo', round: 2, mime: 'image/jpeg', size: 10 })
    expect(parseControl(end(2))).toEqual({ t: 'end', round: 2 })
  })
  it.each([
    ['not json', '{bad'],
    ['null', 'null'],
    ['a number', '5'],
    ['unknown type', '{"t":"nope"}'],
    ['string round', '{"t":"photo","round":"1","mime":"image/jpeg","size":5}'],
    ['fractional size', '{"t":"photo","round":1,"mime":"image/jpeg","size":5.5}'],
    ['wrong mime', '{"t":"photo","round":1,"mime":"image/png","size":5}'],
    ['cam without boolean', '{"t":"cam","mirrored":"yes"}'],
    ['huge', `{"t":"cam","mirrored":true,"pad":"${'x'.repeat(600)}"}`],
  ])('rejects %s', (_name, raw) => {
    expect(parseControl(raw)).toBeNull()
  })
})

describe('chunks', () => {
  it('splits into 16 KiB pieces with a short tail', () => {
    expect([...chunks(bytes(40_000))].map((c) => c.byteLength)).toEqual([16_384, 16_384, 7_232])
  })
  it('yields nothing for an empty buffer', () => {
    expect([...chunks(new ArrayBuffer(0))]).toEqual([])
  })
})

describe('PhotoReceiver — happy path', () => {
  it('assembles a photo sent by sendPhoto, byte for byte', async () => {
    const { receiver, got, rejects, text } = setup(3)
    const channel: PhotoChannel = {
      sendText: (s) => (text(s), true),
      sendBinary: (b) => (receiver.onBinary(b), true),
      waitForDrain: async () => {},
    }
    const original = new Uint8Array(40_000).map((_, i) => i % 251)
    expect(await sendPhoto(channel, 3, new Blob([original], { type: 'image/jpeg' }))).toBe(true)
    expect(rejects).toEqual([])
    expect(got).toHaveLength(1)
    expect(got[0]?.round).toBe(3)
    expect(new Uint8Array(await got[0]!.blob.arrayBuffer())).toEqual(original)
  })

  it('recovers when a new header arrives mid-transfer', () => {
    const { receiver, got, text } = setup()
    text(header(1, 10))
    receiver.onBinary(bytes(5))
    text(header(1, 10)) // sender restarted
    receiver.onBinary(bytes(10))
    text(end(1))
    expect(got).toHaveLength(1)
    expect(got[0]?.blob.size).toBe(10)
  })
})

// Review Focus 4: a broken or hostile partner must never crash us or leave a half-built photo.
describe('PhotoReceiver — hostile input', () => {
  it('rejects a header for the wrong round, then every chunk that follows', () => {
    const { receiver, got, rejects, text } = setup(1)
    text(header(5, 10))
    receiver.onBinary(bytes(10))
    text(end(5))
    expect(rejects).toEqual(['wrong-round', 'unexpected-binary', 'unexpected-end'])
    expect(got).toHaveLength(0)
  })

  it.each([0, PHOTO_MAX_BYTES + 1])('rejects a declared size of %i', (size) => {
    const { receiver, got, rejects, text } = setup()
    text(header(1, size))
    receiver.onBinary(bytes(10))
    expect(rejects[0]).toBe('bad-size')
    expect(got).toHaveLength(0)
  })

  it('rejects a truncated photo at `end`', () => {
    const { receiver, got, rejects, text } = setup()
    text(header(1, 100))
    receiver.onBinary(bytes(50))
    text(end(1))
    expect(rejects).toEqual(['size-mismatch'])
    expect(got).toHaveLength(0)
  })

  it('rejects more bytes than declared, and drops the partial photo', () => {
    const { receiver, got, rejects, text } = setup()
    text(header(1, 10))
    receiver.onBinary(bytes(8))
    receiver.onBinary(bytes(8))
    text(end(1))
    expect(rejects).toEqual(['overflow', 'unexpected-end'])
    expect(got).toHaveLength(0)
  })

  it('rejects `end` and binary data that arrive with no header', () => {
    const { receiver, got, rejects, text } = setup()
    text(end(1))
    receiver.onBinary(bytes(4))
    expect(rejects).toEqual(['unexpected-end', 'unexpected-binary'])
    expect(got).toHaveLength(0)
  })

  it('ignores `cam` messages and non-control junk without throwing', () => {
    const { receiver, got, rejects, text } = setup()
    text('{"t":"cam","mirrored":true}')
    text('definitely not json')
    expect(() => receiver.onControl({ t: 'cam', mirrored: false })).not.toThrow()
    expect(rejects).toEqual([])
    expect(got).toHaveLength(0)
  })
})

describe('sendPhoto', () => {
  const fake = (open = true, failBinaryAfter = Infinity) => {
    const sent: string[] = []
    let binaries = 0
    const channel: PhotoChannel = {
      sendText: (s) => (open ? (sent.push(s), true) : false),
      sendBinary: () => ++binaries <= failBinaryAfter,
      waitForDrain: async () => {},
    }
    return { channel, sent }
  }
  it('returns false when the channel is closed', async () => {
    expect(await sendPhoto(fake(false).channel, 1, new Blob(['x']))).toBe(false)
  })
  it('returns false and sends no `end` when a chunk fails', async () => {
    const { channel, sent } = fake(true, 1)
    expect(await sendPhoto(channel, 1, new Blob([new Uint8Array(40_000)]))).toBe(false)
    expect(sent.some((s) => s.includes('"end"'))).toBe(false)
  })
  it('refuses to send a photo larger than the limit', async () => {
    const { channel, sent } = fake()
    expect(await sendPhoto(channel, 1, new Blob([new Uint8Array(PHOTO_MAX_BYTES + 1)]))).toBe(false)
    expect(sent).toHaveLength(0)
  })
})
