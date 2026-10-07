import { useEffect, useRef, type RefObject } from 'react'

interface Props {
  stream: MediaStream | null
  label: string
  mirrored: boolean
  testId: string
  videoRef?: RefObject<HTMLVideoElement | null>
}

export function CameraFrame({ stream, label, mirrored, testId, videoRef }: Props) {
  const own = useRef<HTMLVideoElement>(null)
  const ref = videoRef ?? own
  useEffect(() => {
    const video = ref.current
    if (!video) return
    video.srcObject = stream
    if (stream) void video.play().catch(() => {}) // autoplay can be refused until a gesture; the element is muted so it normally isn't
  }, [stream, ref])
  return (
    <figure className="relative aspect-[4/3] w-full overflow-hidden border-4 border-black bg-black">
      <video
        ref={ref}
        data-testid={testId}
        aria-label={`${label} camera`}
        autoPlay
        muted
        playsInline
        className="h-full w-full object-cover"
        style={{ transform: mirrored ? 'scaleX(-1)' : undefined }}
      />
      <figcaption className="absolute left-0 top-0 border-b-4 border-r-4 border-black bg-yellow-300 px-2 py-1 text-sm font-black uppercase">
        {label}
      </figcaption>
    </figure>
  )
}
