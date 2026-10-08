// Where the self-hosted MediaPipe assets are served from. The version is part of the path (so the files can be cached
// forever) and must equal the pinned dependency; scripts/vendor-mediapipe.mjs copies the runtime to the same place.
export const MEDIAPIPE_VERSION = '1.1.0'
export const MEDIAPIPE_BASE = `/vendor/mediapipe-${MEDIAPIPE_VERSION}`
export const SEGMENTER_MODEL_URL = '/vendor/models/selfie_segmenter.tflite'
/** Loading the model, or cutting one person out, may take at most this long before we fall back to side by side. */
export const SEGMENT_TIMEOUT_MS = 15_000
