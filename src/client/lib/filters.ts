export type FilterId = 'original' | 'bw' | 'warm' | 'cool' | 'vintage' | 'contrast'

export const FILTERS: ReadonlyArray<{ id: FilterId; label: string }> = [
  { id: 'original', label: 'ORIGINAL' },
  { id: 'bw', label: 'B&W' },
  { id: 'warm', label: 'WARM' },
  { id: 'cool', label: 'COOL' },
  { id: 'vintage', label: 'VINTAGE' },
  { id: 'contrast', label: 'HIGH CONTRAST' },
]

/**
 * In-place per-pixel filters over RGBA data. Done by hand rather than with `ctx.filter` because
 * Safari cannot be relied on for it. Uint8ClampedArray rounds and clamps on assignment.
 */
export function applyFilter(data: Uint8ClampedArray, id: FilterId): void {
  if (id === 'original') return
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] ?? 0
    const g = data[i + 1] ?? 0
    const b = data[i + 2] ?? 0
    switch (id) {
      case 'bw': {
        const y = 0.299 * r + 0.587 * g + 0.114 * b
        data[i] = data[i + 1] = data[i + 2] = y
        break
      }
      case 'warm':
        data[i] = r * 1.08 + 8
        data[i + 1] = g * 1.02
        data[i + 2] = b * 0.9
        break
      case 'cool':
        data[i] = r * 0.92
        data[i + 1] = g
        data[i + 2] = b * 1.1 + 8
        break
      case 'contrast':
        data[i] = (r - 128) * 1.35 + 128
        data[i + 1] = (g - 128) * 1.35 + 128
        data[i + 2] = (b - 128) * 1.35 + 128
        break
      case 'vintage': {
        // 70 % sepia + 30 % original, slightly dimmed, with the blacks lifted.
        const sr = 0.393 * r + 0.769 * g + 0.189 * b
        const sg = 0.349 * r + 0.686 * g + 0.168 * b
        const sb = 0.272 * r + 0.534 * g + 0.131 * b
        data[i] = (sr * 0.7 + r * 0.3) * 0.9 + 20
        data[i + 1] = (sg * 0.7 + g * 0.3) * 0.9 + 20
        data[i + 2] = (sb * 0.7 + b * 0.3) * 0.9 + 20
        break
      }
    }
  }
}
