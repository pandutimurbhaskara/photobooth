import { CHUNK_BYTES, PHOTO_MAX_BYTES } from '../../shared/constants'

export type ChannelControl =
  | { t: 'cam'; mirrored: boolean }
  | { t: 'photo'; round: number; mime: 'image/jpeg'; size: number }
  | { t: 'end'; round: number }

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v)

/** Parse a text frame from the DataChannel. The partner is untrusted: anything unexpected is null. */
export function parseControl(raw: string): ChannelControl | null {
  if (raw.length > 512) return null
  let v: unknown
  try {
    v = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof v !== 'object' || v === null) return null
  const o = v as Record<string, unknown>
  switch (o.t) {
    case 'cam':
      return typeof o.mirrored === 'boolean' ? { t: 'cam', mirrored: o.mirrored } : null
    case 'photo':
      return isInt(o.round) && isInt(o.size) && o.mime === 'image/jpeg'
        ? { t: 'photo', round: o.round, mime: 'image/jpeg', size: o.size }
        : null
    case 'end':
      return isInt(o.round) ? { t: 'end', round: o.round } : null
    default:
      return null
  }
}

export function* chunks(buf: ArrayBuffer, size: number = CHUNK_BYTES): Generator<ArrayBuffer> {
  for (let i = 0; i < buf.byteLength; i += size) yield buf.slice(i, Math.min(i + size, buf.byteLength))
}

/**
 * Reassembles one photo at a time from `photo` header → binary chunks → `end`. Every deviation
 * (wrong round, bad or exceeded size, missing header, truncation) drops the partial photo and
 * reports a reason; a photo is only ever emitted whole and exactly as declared.
 */
export class PhotoReceiver {
  private cur: { round: number; size: number; got: number; parts: ArrayBuffer[] } | null = null

  constructor(
    private readonly expectedRound: () => number,
    private readonly onPhoto: (round: number, blob: Blob) => void,
    private readonly onReject: (reason: string) => void = () => {},
  ) {}

  onControl(c: ChannelControl): void {
    if (c.t === 'photo') {
      if (c.round !== this.expectedRound()) {
        this.cur = null
        this.onReject('wrong-round')
        return
      }
      if (c.size <= 0 || c.size > PHOTO_MAX_BYTES) {
        this.cur = null
        this.onReject('bad-size')
        return
      }
      this.cur = { round: c.round, size: c.size, got: 0, parts: [] }
    } else if (c.t === 'end') {
      const cur = this.cur
      this.cur = null
      if (!cur || cur.round !== c.round) {
        this.onReject('unexpected-end')
        return
      }
      if (cur.got !== cur.size) {
        this.onReject('size-mismatch')
        return
      }
      this.onPhoto(cur.round, new Blob(cur.parts, { type: 'image/jpeg' }))
    }
  }

  onBinary(data: ArrayBuffer): void {
    const cur = this.cur
    if (!cur) {
      this.onReject('unexpected-binary')
      return
    }
    cur.got += data.byteLength
    if (cur.got > cur.size) {
      this.cur = null
      this.onReject('overflow')
      return
    }
    cur.parts.push(data)
  }
}

export interface PhotoChannel {
  sendText(text: string): boolean
  sendBinary(data: ArrayBuffer): boolean
  waitForDrain(): Promise<void>
}

/** Header, chunks (honouring back-pressure), end. Resolves false if the channel is closed or the photo is too big. */
export async function sendPhoto(channel: PhotoChannel, round: number, blob: Blob): Promise<boolean> {
  const buf = await blob.arrayBuffer()
  if (buf.byteLength === 0 || buf.byteLength > PHOTO_MAX_BYTES) return false
  if (!channel.sendText(JSON.stringify({ t: 'photo', round, mime: 'image/jpeg', size: buf.byteLength }))) return false
  for (const chunk of chunks(buf)) {
    if (!channel.sendBinary(chunk)) return false
    await channel.waitForDrain()
  }
  return channel.sendText(JSON.stringify({ t: 'end', round }))
}
