import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test'

export const BASE = 'http://localhost:5199'

let players = 0
const contexts: BrowserContext[] = []

/** Playwright does not close contexts made with browser.newContext(); each live one keeps a fake camera and WebRTC running, so an unclosed suite slows to a crawl. Call from test.afterEach. */
export async function closePlayers(): Promise<void> {
  await Promise.all(contexts.splice(0).map((c) => c.close().catch(() => undefined)))
}

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
    permissions: ['camera', 'clipboard-read', 'clipboard-write'],
    extraHTTPHeaders: { 'CF-Connecting-IP': ip },
    ...opts,
  })
  contexts.push(context)
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

export async function connectedPair(browser: Browser): Promise<{ a: Page; b: Page; url: string }> {
  const a = await newPlayer(browser)
  const b = await newPlayer(browser)
  const url = await createBooth(a)
  await enterBooth(a)
  await b.goto(url)
  await enterBooth(b)
  await expectRemoteVideo(a)
  await expectRemoteVideo(b)
  return { a, b, url }
}

export async function pressReady(page: Page): Promise<void> {
  await page.getByRole('button', { name: /i'm ready/i }).click() // waits for the button to be enabled
}

export interface Captured {
  round: number
  at: number
  wallAt: number
  mirrored: boolean
}

export function lastCapture(page: Page): Promise<Captured | null> {
  return page.evaluate(
    () => (window as unknown as { __booth?: { lastCapture?: Captured } }).__booth?.lastCapture ?? null,
  )
}

export const CELLS = { strip4: 4, grid4: 4, duo2: 2, polaroid: 1 } as const
export type TemplateKey = keyof typeof CELLS
const TEMPLATE_NAME: Record<TemplateKey, RegExp> = { strip4: /4 cut/i, grid4: /2 × 2/, duo2: /2 cut/i, polaroid: /polaroid/i }

/** Pick a format from the cards. Either person can; the other's screen follows. */
export async function chooseTemplate(page: Page, template: TemplateKey): Promise<void> {
  // `.click()`, not `.check()`: the radio is controlled by the server's plan, so it only flips once the room-state returns.
  await page.getByRole('radio', { name: TEMPLATE_NAME[template] }).click()
}

const KEEP = /keep this one/i

/** Shoot `takes` rounds of the current cell (both press ready each time), then wait for the pick panel on both screens. */
export async function shootCell(a: Page, b: Page, takes = 2): Promise<void> {
  for (let t = 0; t < takes; t++) {
    await pressReady(a)
    await pressReady(b)
  }
  for (const page of [a, b]) await expect(page.getByRole('button', { name: KEEP })).toBeVisible({ timeout: 40_000 })
}

/** Both agree on the pick (the preselected, newest take unless someone changed it). */
export async function keepCell(a: Page, b: Page): Promise<void> {
  await a.getByRole('button', { name: KEEP }).click()
  await b.getByRole('button', { name: KEEP }).click()
}

/** The whole session: pick a format, shoot and keep every cell. Ends on the finished strip on both screens. */
export async function finishSession(a: Page, b: Page, template: TemplateKey = 'duo2'): Promise<void> {
  await chooseTemplate(a, template)
  for (let cell = 0; cell < CELLS[template]; cell++) {
    await shootCell(a, b)
    await keepCell(a, b)
  }
  for (const page of [a, b]) await expect(page.getByRole('heading', { name: 'LOOK WHAT YOU MADE.' })).toBeVisible({ timeout: 30_000 })
}
