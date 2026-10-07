import { expect, type Browser, type Page } from '@playwright/test'

export const BASE = 'http://localhost:5199'

let players = 0

/**
 * One isolated browser context = one person (own storage, own participant id) with their own IP.
 * The dev server has no Cloudflare edge to set CF-Connecting-IP, so without this every person would
 * share one rate-limit bucket ("local") and a long e2e run would exhaust it. In production the edge
 * overwrites this header, so it cannot be used to dodge the limiter there.
 */
export async function newPlayer(browser: Browser, opts: { viewport?: { width: number; height: number } } = {}): Promise<Page> {
  players += 1
  const ip = `10.0.${Math.floor(players / 250)}.${(players % 250) + 1}`
  const context = await browser.newContext({
    baseURL: BASE,
    permissions: ['camera'],
    extraHTTPHeaders: { 'CF-Connecting-IP': ip },
    ...opts,
  })
  return context.newPage()
}

export async function createBooth(page: Page): Promise<string> {
  await page.goto('/create')
  await page.waitForURL(/\/b\/[A-HJ-KM-NP-Z2-9]{6}$/)
  return page.url()
}

export async function enterBooth(page: Page): Promise<void> {
  await page.getByRole('button', { name: /turn on camera/i }).click()
}

export async function expectRemoteVideo(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const v = document.querySelector<HTMLVideoElement>('[data-testid="remote-video"]')
          return !!v && v.videoWidth > 0 && v.currentTime > 0
        }),
      { message: 'remote video should be decoding frames' },
    )
    .toBe(true)
}
