import { describe, expect, it } from 'vitest'
import { buildIceServers } from './ice'

const STUN_ONLY = [{ urls: 'stun:stun.cloudflare.com:3478' }]
const TURN = { urls: ['turn:turn.cloudflare.com:3478?transport=udp'], username: 'u', credential: 'c' }

describe('buildIceServers', () => {
  it('returns STUN only when TURN is not configured', async () => {
    expect(await buildIceServers({ TURN_KEY_ID: '', TURN_KEY_API_TOKEN: undefined })).toEqual(STUN_ONLY)
    expect(await buildIceServers({ TURN_KEY_ID: 'k', TURN_KEY_API_TOKEN: undefined })).toEqual(STUN_ONLY)
  })

  it('mints short-lived credentials from Cloudflare when configured', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    const fake = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} })
      return Response.json({ iceServers: [{ urls: ['stun:stun.cloudflare.com:3478'] }, TURN] }, { status: 201 })
    }) as typeof fetch
    const servers = await buildIceServers({ TURN_KEY_ID: 'key123', TURN_KEY_API_TOKEN: 'secret' }, fake)
    expect(servers).toEqual([{ urls: ['stun:stun.cloudflare.com:3478'] }, TURN])
    expect(calls).toHaveLength(1)
    const [call] = calls
    expect(call?.url).toBe('https://rtc.live.cloudflare.com/v1/turn/keys/key123/credentials/generate-ice-servers')
    expect(call?.init.method).toBe('POST')
    expect((call?.init.headers as Record<string, string>).Authorization).toBe('Bearer secret')
    expect(JSON.parse(String(call?.init.body))).toEqual({ ttl: 3600 })
  })

  it('falls back to STUN when Cloudflare errors or throws', async () => {
    const env = { TURN_KEY_ID: 'k', TURN_KEY_API_TOKEN: 't' }
    expect(await buildIceServers(env, (async () => new Response('no', { status: 500 })) as typeof fetch)).toEqual(STUN_ONLY)
    expect(await buildIceServers(env, (async () => { throw new Error('offline') }) as typeof fetch)).toEqual(STUN_ONLY)
    expect(await buildIceServers(env, (async () => Response.json({ iceServers: [] })) as typeof fetch)).toEqual(STUN_ONLY)
  })
})
