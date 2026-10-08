import { useEffect, useState } from 'react'
import type { TemplateId } from '../../shared/plan'
import type { Scene } from '../lib/backgrounds'
import { cutoutKey, type Cutout } from '../lib/cutout'
import { canvasToBlob } from '../lib/photo'
import { renderStrip, type CellContent, type StripMeta } from '../lib/strip'
import type { CellBlobs } from '../lib/takes'
import { useLatest } from './useLatest'

/**
 * Composes the strip whenever the kept photos, template, metadata, background or cutouts change; exposes an object URL
 * for display and the canvas for export. `cells` is read through a ref and keyed by content, so a new array with the
 * same photos does not recompose. `scene` is null for "side by side" (also while cutouts are still loading or failed).
 */
export function useStrip(
  cells: readonly CellBlobs[] | null,
  template: TemplateId | null,
  meta: StripMeta,
  scene: Scene | null,
  cutouts: ReadonlyMap<string, Cutout>,
) {
  const [url, setUrl] = useState<string | null>(null)
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null)
  const [error, setError] = useState(false)
  const latest = useLatest(cells)
  const key = cells ? cells.map((c) => `${c.kind}:${c.round}`).join('|') : ''

  useEffect(() => {
    const current = latest.current
    if (!current || !template) return
    let cancelled = false
    let objectUrl: string | null = null
    const opened: ImageBitmap[] = []
    void (async () => {
      try {
        const content: CellContent[] = []
        for (const [i, cell] of current.entries()) {
          const a = cell.kind !== 'b' ? await createImageBitmap(cell.a) : undefined
          const b = cell.kind !== 'a' ? await createImageBitmap(cell.b) : undefined
          for (const bmp of [a, b]) if (bmp) opened.push(bmp)
          content.push({
            kind: cell.kind,
            a,
            b,
            seed: `${meta.code}:${i}:${cell.round}`,
            scene: cell.kind === 'both' && scene ? scene : undefined,
            cutouts: { a: cutouts.get(cutoutKey(cell.round, 'a')), b: cutouts.get(cutoutKey(cell.round, 'b')) },
          })
        }
        const composed = await renderStrip(content, template, meta)
        const png = await canvasToBlob(composed, 'image/png')
        if (cancelled) return
        objectUrl = URL.createObjectURL(png)
        setCanvas(composed)
        setUrl(objectUrl)
        setError(false)
      } catch {
        if (!cancelled) setError(true)
      } finally {
        opened.forEach((bmp) => bmp.close())
      }
    })()
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [key, template, meta, scene, cutouts, latest])

  return { url, canvas, error }
}
