import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from './constants'

const SIZE = ROOM_CODE_ALPHABET.length
// Largest multiple of SIZE that fits in a byte; bytes at or above it are discarded
// so `byte % SIZE` is uniform (rejection sampling).
const LIMIT = 256 - (256 % SIZE)
const VALID = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`)

type Bytes = Uint8Array<ArrayBuffer> // TS 6 typed arrays are generic; getRandomValues wants a non-shared buffer

export function generateRoomCode(random: (buf: Bytes) => Bytes = (buf) => crypto.getRandomValues(buf)): string {
  let out = ''
  while (out.length < ROOM_CODE_LENGTH) {
    for (const byte of random(new Uint8Array(16))) {
      if (byte < LIMIT && out.length < ROOM_CODE_LENGTH) out += ROOM_CODE_ALPHABET[byte % SIZE]
    }
  }
  return out
}

export function isValidRoomCode(value: unknown): value is string {
  return typeof value === 'string' && VALID.test(value)
}

export function normalizeRoomInput(input: string): string | null {
  const fromUrl = /\/b\/([^/?#\s]+)/i.exec(input)
  const code = (fromUrl?.[1] ?? input).toUpperCase().replace(/[\s-]/g, '')
  return isValidRoomCode(code) ? code : null
}

export function formatRoomCode(code: string): string {
  return `${code.slice(0, 3)} ${code.slice(3)}`
}
