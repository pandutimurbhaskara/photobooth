import { env } from 'cloudflare:workers'
import { afterEach, describe, expect, it } from 'vitest'
import { isValidRoomCode } from '../shared/room-code'
import worker from './index'
import { newRoom } from './test-helpers'

// The handler is typed for requests arriving from the edge, which carry IncomingRequestCfProperties.
const IncomingRequest = Request<unknown, IncomingRequestCfProperties>

const open: WebSocket[] = []
afterEach(() => {
  for (const ws of open.splice(0)) ws.close(1000, 'done')
})

type Init = RequestInit<IncomingRequestCfProperties>

function call(path: string, init?: Init, e: Env = env): Promise<Response> {
  return worker.fetch(new IncomingRequest(`https://booth.test${path}`, init), e)
}

const limited = (name: 'RL_CREATE' | 'RL_LOOKUP'): Env =>
  new Proxy(env, { get: (t, k, r) => (k === name ? { limit: async () => ({ success: false }) } : Reflect.get(t, k, r)) })

describe('POST /api/rooms', () => {
  it('creates a room with a valid code that then exists', async () => {
    const res = await call('/api/rooms', { method: 'POST' })
    expect(res.status).toBe(201)
    const { code } = (await res.json()) as { code: string }
    expect(isValidRoomCode(code)).toBe(true)
    const lookup = await call(`/api/rooms/${code}`)
    expect(lookup.status).toBe(200)
    expect(await lookup.json()).toEqual({ full: false })
  })
  it('is rate limited', async () => {
    expect((await call('/api/rooms', { method: 'POST' }, limited('RL_CREATE'))).status).toBe(429)
  })
  it('rejects other methods', async () => {
    expect((await call('/api/rooms')).status).toBe(404)
  })
})

describe('GET /api/rooms/:code', () => {
  it('400 for a malformed code, 404 for an unknown one', async () => {
    expect((await call('/api/rooms/abc')).status).toBe(400)
    expect((await call('/api/rooms/ZZZZZZ')).status).toBe(404)
  })
  it('is rate limited', async () => {
    expect((await call('/api/rooms/ZZZZZZ', undefined, limited('RL_LOOKUP'))).status).toBe(429)
  })
  it('ignores a malformed x-participant-id instead of erroring', async () => {
    const code = await newRoom()
    const res = await call(`/api/rooms/${code}`, { headers: { 'x-participant-id': 'not valid!' } })
    expect(res.status).toBe(200)
  })
})

describe('GET /api/rooms/:code/ws', () => {
  const upgrade = (origin?: string): Init => ({
    headers: { Upgrade: 'websocket', ...(origin ? { Origin: origin } : {}) },
  })

  it('upgrades for a same-host Origin', async () => {
    const code = await newRoom()
    const res = await call(`/api/rooms/${code}/ws`, upgrade('https://booth.test'))
    expect(res.status).toBe(101)
    expect(res.webSocket).not.toBeNull()
    res.webSocket?.accept()
    if (res.webSocket) open.push(res.webSocket)
  })
  it('accepts an http/https scheme mismatch (TLS-terminating tunnels)', async () => {
    const code = await newRoom()
    const res = await call(`/api/rooms/${code}/ws`, upgrade('http://booth.test'))
    expect(res.status).toBe(101)
    res.webSocket?.accept()
    if (res.webSocket) open.push(res.webSocket)
  })
  it('403 for a foreign or missing Origin', async () => {
    const code = await newRoom()
    expect((await call(`/api/rooms/${code}/ws`, upgrade('https://evil.test'))).status).toBe(403)
    expect((await call(`/api/rooms/${code}/ws`, upgrade())).status).toBe(403)
  })
  it('426 without an Upgrade header, 404 for a never-created room, 400 for a bad code', async () => {
    const code = await newRoom()
    expect((await call(`/api/rooms/${code}/ws`)).status).toBe(426)
    expect((await call('/api/rooms/ZZZZZZ/ws', upgrade('https://booth.test'))).status).toBe(404)
    expect((await call('/api/rooms/nope/ws', upgrade('https://booth.test'))).status).toBe(400)
  })
})

describe('GET /api/ice', () => {
  it('404 for an unknown room, 400 for a bad one, STUN for a real one', async () => {
    expect((await call('/api/ice?room=ZZZZZZ')).status).toBe(404)
    expect((await call('/api/ice?room=bad')).status).toBe(400)
    expect((await call('/api/ice')).status).toBe(400)
    const code = await newRoom()
    const res = await call(`/api/ice?room=${code}`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }] })
  })
  it('is rate limited', async () => {
    expect((await call('/api/ice?room=ZZZZZZ', undefined, limited('RL_LOOKUP'))).status).toBe(429)
  })
})

describe('fallthrough', () => {
  it('answers unknown /api paths with 404 json', async () => {
    const res = await call('/api/whatever')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'not-found' })
  })
})
