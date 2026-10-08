import type { ImageSegmenter } from '@mediapipe/tasks-vision'
import { alphaBounds, invertMask, maskToAlpha, shouldInvert, type Cutout } from './cutout'
import { MEDIAPIPE_BASE, SEGMENT_TIMEOUT_MS, SEGMENTER_MODEL_URL } from './vendor'

export function withTimeout<T>(promise: Promise<T>, ms: number, what = 'operation'): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error instanceof Error ? error : new Error(String(error)))
      },
    )
  })
}

let loading: Promise<ImageSegmenter> | null = null

/** One segmenter per tab, built the first time anyone asks. The WASM and the model come from this origin, never a CDN. */
export function loadSegmenter(): Promise<ImageSegmenter> {
  if (!loading) {
    const attempt = withTimeout(
      import('@mediapipe/tasks-vision').then(async ({ FilesetResolver, ImageSegmenter: Segmenter }) => {
        const fileset = await FilesetResolver.forVisionTasks(MEDIAPIPE_BASE)
        return Segmenter.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: SEGMENTER_MODEL_URL, delegate: 'CPU' },
          runningMode: 'IMAGE',
          outputCategoryMask: false,
          outputConfidenceMasks: true,
        })
      }),
      SEGMENT_TIMEOUT_MS,
      'loading the cutout model',
    )
    loading = attempt
    attempt.catch(() => {
      if (loading === attempt) loading = null // a failed load is forgotten, so the next attempt starts clean
    })
  }
  return loading
}

function canvasOf(w: number, h: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  return canvas
}

/**
 * Cut the person out of one photo. Runs on the main thread (a handful of calls per strip).
 * // ponytail: main thread; move it to a Worker if it janks on real phones.
 */
export async function cutOut(photo: Blob): Promise<Cutout> {
  const bitmap = await createImageBitmap(photo)
  try {
    const segmenter = await loadSegmenter()
    const result = segmenter.segment(bitmap)
    try {
      const masks = result.confidenceMasks ?? []
      const mask = masks[masks.length - 1] // [background, person] — or just [person] for a single-output model
      if (!mask) throw new Error('the segmenter returned no mask')
      const raw = mask.getAsFloat32Array()
      const alpha = maskToAlpha(shouldInvert(raw, mask.width, mask.height) ? invertMask(raw) : raw)
      const found = alphaBounds(alpha, mask.width, mask.height)
      if (!found) throw new Error('no person found in this photo')

      // The mask is small (about 256 px): paint it as alpha on a mask-sized canvas, then let the browser scale it
      // up smoothly while it is applied to the full-size photo.
      const maskCanvas = canvasOf(mask.width, mask.height)
      const maskCtx = maskCanvas.getContext('2d')
      const out = canvasOf(bitmap.width, bitmap.height)
      const ctx = out.getContext('2d')
      if (!maskCtx || !ctx) throw new Error('2d canvas is unavailable')
      const image = maskCtx.createImageData(mask.width, mask.height)
      for (let i = 0; i < alpha.length; i++) {
        image.data[i * 4] = 255
        image.data[i * 4 + 1] = 255
        image.data[i * 4 + 2] = 255
        image.data[i * 4 + 3] = alpha[i] ?? 0
      }
      maskCtx.putImageData(image, 0, 0)
      ctx.drawImage(bitmap, 0, 0)
      ctx.globalCompositeOperation = 'destination-in'
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(maskCanvas, 0, 0, out.width, out.height)

      const sx = bitmap.width / mask.width
      const sy = bitmap.height / mask.height
      return { canvas: out, bounds: { x: found.x * sx, y: found.y * sy, w: found.w * sx, h: found.h * sy } }
    } finally {
      result.close()
    }
  } finally {
    bitmap.close()
  }
}
