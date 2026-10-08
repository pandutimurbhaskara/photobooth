import { PARTICIPANT_ID_RE } from '../shared/protocol'
import { generateRoomCode, isValidRoomCode } from '../shared/room-code'
import { buildIceServers } from './ice'

export { BoothRoom } from './BoothRoom'

const json = (body: unknown, status = 200): Response =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store' } })

const ROOM = /^\/api\/rooms\/([^/]+)$/
const ROOM_WS = /^\/api\/rooms\/([^/]+)\/ws$/

const clientKey = (request: Request, scope: string): string =>
  `${scope}:${request.headers.get('CF-Connecting-IP') ?? 'local'}`

/** Compare hosts, not full origins: a TLS-terminating tunnel makes the Worker see http while the browser sends https. */
function sameHost(request: Request, url: URL): boolean {
  const origin = request.headers.get('Origin')
  if (origin === null) return false
  try {
    return new URL(origin).host === url.host
  } catch {
    return false
  }
}

/**
 * For plain fetches: browsers omit Origin on a same-origin GET, but always send Sec-Fetch-Site (a header scripts cannot set).
 * A WebSocket upgrade always carries Origin, which is why `sameHost` alone is enough there.
 */
function sameSite(request: Request, url: URL): boolean {
  if (request.headers.get('Origin') !== null) return sameHost(request, url)
  return request.headers.get('Sec-Fetch-Site') === 'same-origin'
}

async function createRoom(request: Request, env: Env): Promise<Response> {
  if (!(await env.RL_CREATE.limit({ key: clientKey(request, 'create') })).success) {
    return json({ error: 'rate-limited' }, 429)
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateRoomCode()
    if (await env.BOOTH_ROOM.getByName(code).create(code)) return json({ code }, 201)
  }
  return json({ error: 'unavailable' }, 503)
}

/** Shared pre-checks for every route that targets an existing room code. */
async function guard(request: Request, env: Env, code: string): Promise<Response | null> {
  if (!isValidRoomCode(code)) return json({ error: 'invalid-code' }, 400)
  if (!(await env.RL_LOOKUP.limit({ key: clientKey(request, 'lookup') })).success) {
    return json({ error: 'rate-limited' }, 429)
  }
  return null
}

async function lookup(request: Request, env: Env, code: string): Promise<Response> {
  const raw = request.headers.get('x-participant-id')
  const participantId = raw !== null && PARTICIPANT_ID_RE.test(raw) ? raw : null
  const status = await env.BOOTH_ROOM.getByName(code).status(participantId)
  return status.exists ? json({ full: status.full }) : json({ error: 'room-not-found' }, 404)
}

async function socket(request: Request, env: Env, url: URL, code: string): Promise<Response> {
  if (request.headers.get('Upgrade') !== 'websocket') return json({ error: 'expected-websocket' }, 426)
  if (!sameHost(request, url)) return json({ error: 'forbidden-origin' }, 403)
  return env.BOOTH_ROOM.getByName(code).fetch(request)
}

/** Mints (possibly TURN) credentials, so: same-site callers only, who are in the room, a few per hour per room. */
async function ice(request: Request, env: Env, url: URL, code: string): Promise<Response> {
  if (!sameSite(request, url)) return json({ error: 'forbidden-origin' }, 403)
  const room = env.BOOTH_ROOM.getByName(code)
  if (!(await room.status(null)).exists) return json({ error: 'room-not-found' }, 404)
  const raw = request.headers.get('x-participant-id')
  const verdict = raw !== null && PARTICIPANT_ID_RE.test(raw) ? await room.iceAllowed(raw) : 'not-member'
  if (verdict === 'not-member') return json({ error: 'not-a-member' }, 403)
  if (verdict === 'quota') return json({ error: 'rate-limited' }, 429)
  return json({ iceServers: await buildIceServers(env) })
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url)
    const { pathname } = url
    if (!pathname.startsWith('/api/')) return env.ASSETS.fetch(request)

    if (request.method === 'POST' && pathname === '/api/rooms') return createRoom(request, env)

    if (request.method === 'GET' && pathname === '/api/ice') {
      const code = url.searchParams.get('room') ?? ''
      return (await guard(request, env, code)) ?? ice(request, env, url, code)
    }

    const ws = ROOM_WS.exec(pathname)
    if (ws?.[1] && request.method === 'GET') {
      return (await guard(request, env, ws[1])) ?? socket(request, env, url, ws[1])
    }

    const one = ROOM.exec(pathname)
    if (one?.[1] && request.method === 'GET') {
      return (await guard(request, env, one[1])) ?? lookup(request, env, one[1])
    }

    return json({ error: 'not-found' }, 404)
  },
} satisfies ExportedHandler<Env>
