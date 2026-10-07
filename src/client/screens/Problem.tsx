import { Link } from 'react-router'

export type ProblemKind =
  | 'camera-blocked'
  | 'camera-unavailable'
  | 'camera-unsupported'
  | 'room-full'
  | 'not-found'
  | 'expired'
  | 'replaced'
  | 'connection-lost'
  | 'webrtc-failed'
  | 'gate-error'

type Action = { label: string; kind: 'retry' } | { label: string; kind: 'link'; to: string }

const COPY: Record<ProblemKind, { title: string; body: string; action: Action }> = {
  'camera-blocked': { title: 'CAMERA BLOCKED', body: 'WE NEED CAMERA ACCESS TO USE THE BOOTH.', action: { label: 'TRY AGAIN', kind: 'retry' } },
  'camera-unavailable': { title: 'NO CAMERA FOUND', body: 'PLUG ONE IN, OR CLOSE OTHER APPS USING IT.', action: { label: 'TRY AGAIN', kind: 'retry' } },
  'camera-unsupported': { title: 'CAMERA NEEDS HTTPS', body: 'OPEN THIS PAGE OVER A SECURE (HTTPS) CONNECTION.', action: { label: 'EXIT', kind: 'link', to: '/' } },
  'room-full': { title: 'BOOTH FULL.', body: 'THIS BOOTH ALREADY HAS TWO PEOPLE.', action: { label: 'CREATE NEW BOOTH', kind: 'link', to: '/create' } },
  'not-found': { title: 'NO SUCH BOOTH.', body: "THAT CODE DOESN'T MATCH A BOOTH. IT MAY HAVE EXPIRED.", action: { label: 'CREATE NEW BOOTH', kind: 'link', to: '/create' } },
  expired: { title: 'BOOTH CLOSED.', body: 'THIS BOOTH WAS IDLE FOR AN HOUR.', action: { label: 'CREATE NEW BOOTH', kind: 'link', to: '/create' } },
  replaced: { title: 'OPENED ELSEWHERE.', body: 'THIS BOOTH IS OPEN IN ANOTHER TAB.', action: { label: 'EXIT', kind: 'link', to: '/' } },
  'connection-lost': { title: '! CONNECTION LOST', body: "WE COULDN'T REACH THE BOOTH.", action: { label: 'RECONNECT', kind: 'retry' } },
  'webrtc-failed': { title: 'CAMERA CONNECTION FAILED.', body: 'CHECK YOUR NETWORK AND TRY AGAIN.', action: { label: 'RECONNECT', kind: 'retry' } },
  'gate-error': { title: 'SOMETHING BROKE.', body: "WE COULDN'T CHECK THIS BOOTH.", action: { label: 'TRY AGAIN', kind: 'retry' } },
}

interface Props {
  kind: ProblemKind
  onRetry?: () => void
}

export function Problem({ kind, onRetry }: Props) {
  const { title, body, action } = COPY[kind]
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-4 p-6" role="alert">
      <h1 className="text-4xl font-black">{title}</h1>
      <p className="text-lg font-bold">{body}</p>
      {action.kind === 'retry' ? (
        <button type="button" onClick={onRetry} className="border-4 border-black px-4 py-3 font-black">
          {action.label}
        </button>
      ) : (
        <Link to={action.to} className="border-4 border-black px-4 py-3 text-center font-black">
          {action.label}
        </Link>
      )}
    </main>
  )
}
