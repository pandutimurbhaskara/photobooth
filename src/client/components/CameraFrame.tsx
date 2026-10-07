import { useEffect, useRef, type ReactNode, type RefObject } from 'react'
import { BrutalLabel } from './BrutalLabel'

const ACCENT = { pink: 'bg-pink', blue: 'bg-blue', lime: 'bg-lime', yellow: 'bg-yellow' } as const

interface Props {
  stream: MediaStream | null
  label: string
  mirrored: boolean
  testId: string
  videoRef?: RefObject<HTMLVideoElement | null>
  accent?: keyof typeof ACCENT
  children?: ReactNode
}

/** A live camera as a printed photo: coloured backing, thick frame, taped-on tags. No glass, nothing over the picture but what you add. */
export function CameraFrame({ stream, label, mirrored, testId, videoRef, accent = 'yellow', children }: Props) {
  const own = useRef<HTMLVideoElement>(null)
  const ref = videoRef ?? own
  useEffect(() => {
    const video = ref.current
    if (!video) return
    video.srcObject = stream
    if (stream) void video.play().catch(() => {})
  }, [stream, ref])

  return (
    <div className={`relative border-4 border-ink p-3 pt-5 shadow-brutal ${ACCENT[accent]}`}>
      <div className="absolute -top-3 left-3 flex items-center gap-2">
        <BrutalLabel tone="ink">{label}</BrutalLabel>
        <BrutalLabel tone="paper" tilt="right" aria-hidden="true">
          CAM
        </BrutalLabel>
      </div>
      <span aria-hidden="true" className="absolute -top-3 right-3 border-[3px] border-ink bg-orange px-2 py-0.5 text-xs font-black">
        ● REC
      </span>
      <figure className="relative aspect-[4/3] w-full overflow-hidden border-4 border-ink bg-ink">
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
        {children}
      </figure>
    </div>
  )
}
