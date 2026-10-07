import { env } from 'cloudflare:workers'
import { expect, it } from 'vitest'

it('exposes a BOOTH_ROOM Durable Object namespace', () => {
  expect(typeof env.BOOTH_ROOM.getByName).toBe('function')
})
