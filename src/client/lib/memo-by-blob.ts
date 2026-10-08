/**
 * Memoise async work per photo *object* — never by value and never by round number, which restarts at 1 in every
 * booth. One photo, one result, so a cutout can never be shown for the wrong person. Because it is a WeakMap, a photo
 * that is pruned from the store takes its cached result with it. A failure is forgotten so the next call retries.
 */
export function memoByBlob<T>(work: (photo: Blob) => Promise<T>): (photo: Blob) => Promise<T> {
  const cache = new WeakMap<Blob, Promise<T>>()
  return (photo) => {
    let hit = cache.get(photo)
    if (!hit) {
      hit = work(photo)
      cache.set(photo, hit)
      hit.catch(() => cache.delete(photo))
    }
    return hit
  }
}
