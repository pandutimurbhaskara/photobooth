export const APP_NAME = 'TWO-UP'

// Room codes
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export const ROOM_CODE_LENGTH = 6

// Room lifecycle (Durable Object)
export const CAPTURE_LEAD_MS = 4500
export const EXCHANGE_TIMEOUT_MS = 30_000
export const SLOT_GRACE_MS = 120_000
export const ROOM_IDLE_MS = 3_600_000
export const ACTIVITY_PERSIST_MS = 60_000

// WebSocket limits
export const MAX_WS_FRAME_BYTES = 16 * 1024
export const MAX_SDP_CHARS = 12 * 1024
export const MAX_CANDIDATE_CHARS = 2 * 1024
export const BUCKET_CAPACITY = 60
export const BUCKET_REFILL_PER_SEC = 10
export const MAX_SOCKETS = 4
// TURN credentials one room may mint per hour (each reconnect builds a new peer connection, so allow for a few).
export const ICE_PER_HOUR = 30
export const ICE_WINDOW_MS = 3_600_000
// Heartbeat: the client sends a raw 'ka' (answered by the runtime with 'ok') and gives up on a silent socket.
export const KEEPALIVE_MS = 20_000
export const KEEPALIVE_DEAD_MS = 50_000

export const CLOSE = {
  EXPIRED: 4000,
  REPLACED: 4001,
  INVALID: 4400,
  FULL: 4403,
  NOT_FOUND: 4404,
  RATE_LIMITED: 4429,
} as const

// Clock sync + capture (client)
export const SYNC_BURST_INITIAL = 8
export const SYNC_BURST_READY = 4
export const SYNC_SPACING_MS = 250
export const SYNC_WINDOW = 12
export const CAPTURE_SPIN_MS = 40
export const LATE_GRACE_MS = 1500

// Photos
export const PHOTO_MAX_EDGE = 1280
export const PHOTO_JPEG_QUALITY = 0.85
export const PHOTO_MAX_BYTES = 3 * 1024 * 1024
export const CHUNK_BYTES = 16 * 1024
export const CELL_ASPECT = 4 / 3

export const DEFAULT_STUN = 'stun:stun.cloudflare.com:3478'
