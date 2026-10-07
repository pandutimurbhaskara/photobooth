/** The finished strip, framed like a print pinned to a board. */
export function PhotoStrip({ url, error }: { url: string | null; error: boolean }) {
  if (error) {
    return (
      <p role="alert" className="border-4 border-ink bg-orange p-4 text-lg font-black uppercase">
        COULDN'T BUILD THE STRIP. TRY A DIFFERENT LAYOUT.
      </p>
    )
  }
  if (!url) return <p className="border-4 border-ink bg-yellow p-4 text-lg font-black uppercase">DEVELOPING...</p>
  return (
    <div className="mx-auto w-fit max-w-full rotate-1 border-4 border-ink bg-white p-2 shadow-brutal">
      <img src={url} alt="Photo strip" className="block max-h-[70dvh] max-w-full" />
    </div>
  )
}
