import type { CellKind } from '../../shared/plan'
import { useBlobUrl } from '../hooks/useBlobUrl'

interface Props {
  kind: CellKind
  a?: Blob
  b?: Blob
  className?: string
}

/**
 * A still of one cell: USER 1's photo, USER 2's, or both side by side. `object-cover` on a half-width box is the
 * same centred crop the strip uses for a TOGETHER cell, so what you pick is what you get.
 */
export function PhotoThumb({ kind, a, b, className = '' }: Props) {
  const urlA = useBlobUrl(kind === 'b' ? undefined : a)
  const urlB = useBlobUrl(kind === 'a' ? undefined : b)
  return (
    <span className={`flex aspect-[4/3] w-full overflow-hidden border-[3px] border-ink bg-ink ${className}`}>
      {urlA && <img src={urlA} alt="" className={`h-full object-cover ${kind === 'both' ? 'w-1/2' : 'w-full'}`} />}
      {urlB && <img src={urlB} alt="" className={`h-full object-cover ${kind === 'both' ? 'w-1/2' : 'w-full'}`} />}
    </span>
  )
}
