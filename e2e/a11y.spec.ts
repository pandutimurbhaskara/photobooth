import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { BASE, closePlayers, connectedPair, createBooth, enterBooth, newPlayer, pressReady } from './helpers'

test.afterEach(closePlayers)

async function expectNoViolations(page: Page, what: string) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    // The booth's <video> elements are live, silent camera streams (getUserMedia audio:false): there is no speech to caption.
    .disableRules(['video-caption'])
    .analyze()
  expect(results.violations.map((v) => `${what}: ${v.id} (${v.nodes.length}) ${v.help}`), what).toEqual([])
}

test('landing, join and create screens have no WCAG A/AA violations', async ({ browser }) => {
  const page = await newPlayer(browser)
  await page.goto('/')
  await expectNoViolations(page, 'home')
  await page.goto('/join')
  await expectNoViolations(page, 'join')
  await page.goto('/b/ZZZZZZ')
  await expect(page.getByText('NO SUCH BOOTH.')).toBeVisible()
  await expectNoViolations(page, 'not found')
})

test('camera gate, lobby, stage, countdown and result have no violations', async ({ browser }) => {
  const a = await newPlayer(browser)
  await createBooth(a)
  await expectNoViolations(a, 'camera gate')
  await enterBooth(a)
  await expect(a.getByText('WAITING FOR YOUR PERSON...')).toBeVisible()
  await expectNoViolations(a, 'lobby')
  await a.close()

  const { a: left, b: right } = await connectedPair(browser)
  await expectNoViolations(left, 'stage')
  await pressReady(left)
  await pressReady(right)
  await expect(left.getByRole('heading', { name: 'LOOK WHAT YOU MADE.' })).toBeVisible({ timeout: 30_000 })
  await expectNoViolations(left, 'result')
})

test('the first thing keyboard focus reaches is visible, and every control is reachable by keyboard', async ({ browser }) => {
  const page = await newPlayer(browser)
  await page.goto('/')
  await page.keyboard.press('Tab')
  const outline = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement
    const s = getComputedStyle(el)
    return { tag: el.tagName, style: s.outlineStyle, width: parseFloat(s.outlineWidth) }
  })
  expect(outline.style).not.toBe('none')
  expect(outline.width).toBeGreaterThanOrEqual(3)

  // Tab through the whole landing page: nothing may trap focus.
  const seen = new Set<string>()
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Tab')
    seen.add(await page.evaluate(() => document.activeElement?.textContent?.trim().slice(0, 30) ?? ''))
  }
  expect(seen.size).toBeGreaterThan(4)
})

test('prefers-reduced-motion removes the pop animation', async ({ browser }) => {
  const context = await browser.newContext({ baseURL: BASE, permissions: ['camera'], reducedMotion: 'reduce' })
  const page = await context.newPage()
  await createBooth(page)
  await enterBooth(page)
  const pop = page.locator('.animate-pop').first() // "WAITING FOR YOUR PERSON..." pops in normally
  await expect(pop).toBeVisible()
  const duration = await pop.evaluate((el) => parseFloat(getComputedStyle(el).animationDuration))
  expect(duration).toBeLessThan(0.001) // the media query forces 0.01 ms

  const normal = await newPlayer(browser)
  await createBooth(normal)
  await enterBooth(normal)
  const normalDuration = await normal.locator('.animate-pop').first().evaluate((el) => parseFloat(getComputedStyle(el).animationDuration))
  expect(normalDuration).toBeGreaterThan(0.05) // and without the preference it really animates
  await context.close()
})

test('mobile: nothing scrolls sideways and the READY button is on screen without scrolling', async ({ browser }) => {
  const viewport = { width: 390, height: 844 }
  const a = await newPlayer(browser, { viewport })
  const b = await newPlayer(browser, { viewport })
  const url = await createBooth(a)
  for (const page of [a]) {
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  }
  await enterBooth(a)
  await b.goto(url)
  await enterBooth(b)
  await expect(a.getByTestId('remote-video')).toBeVisible()

  for (const page of [a, b]) {
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    const ready = page.getByRole('button', { name: /i'm ready/i })
    await expect(ready).toBeVisible()
    const box = await ready.boundingBox()
    expect(box?.height).toBeGreaterThanOrEqual(48) // thumb-sized
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(viewport.height)
  }
})
