import { DEFAULT_STUN } from '../shared/constants'
import type { IceServerConfig } from '../shared/protocol'

const STUN_ONLY: IceServerConfig[] = [{ urls: DEFAULT_STUN }]

/**
 * STUN always. When Cloudflare Realtime TURN is configured (TURN_KEY_ID var + TURN_KEY_API_TOKEN
 * secret) mint short-lived credentials server-side, so no long-lived secret ever reaches a browser.
 * Any failure degrades to STUN-only: direct connections still work for most networks.
 */
export async function buildIceServers(
  env: { TURN_KEY_ID?: string; TURN_KEY_API_TOKEN?: string },
  fetchImpl: typeof fetch = fetch,
): Promise<IceServerConfig[]> {
  if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN) return STUN_ONLY
  try {
    const res = await fetchImpl(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`, 'content-type': 'application/json' },
        body: JSON.stringify({ ttl: 3600 }),
      },
    )
    if (!res.ok) return STUN_ONLY
    const body = (await res.json()) as { iceServers?: IceServerConfig[] }
    return Array.isArray(body.iceServers) && body.iceServers.length > 0 ? body.iceServers : STUN_ONLY
  } catch {
    return STUN_ONLY
  }
}
