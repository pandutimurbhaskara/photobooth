import { useEffect, useState } from 'react'
import { canvasToBlob, type StripLayout } from '../lib/photo'
import { renderStrip, type StripMeta } from '../lib/strip'

/** Composes the strip whenever the photos, layout or metadata change; exposes an object URL for display and the canvas for export. */
export function useStrip(blobs: Blob[] | null, layout: StripLayout, meta: StripMeta) {
  const [url, setUrl] = useState<string | null>(null)
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!blobs) return
    let cancelled = false
    let objectUrl: string | null = null
    void (async () => {
      try {
        const bitmaps = await Promise.all(blobs.map((b) => createImageBitmap(b)))
        const composed = await renderStrip(bitmaps, layout, meta)
        bitmaps.forEach((b) => b.close())
        const png = await canvasToBlob(composed, 'image/png')
        if (cancelled) return
        objectUrl = URL.createObjectURL(png)
        setCanvas(composed)
        setUrl(objectUrl)
        setError(false)
      } catch {
        if (!cancelled) setError(true)
      }
    })()
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [blobs, layout, meta])

  return { url, canvas, error }
}
