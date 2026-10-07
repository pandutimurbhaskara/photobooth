import { expect, test, type Page } from '@playwright/test'
import { closePlayers, connectedPair, createBooth, enterBooth, expectRemoteVideo, lastCapture, newPlayer, pressReady } from './helpers'

test.afterEach(closePlayers)

const FLIPPED = 'matrix(-1, 0, 0, 1, 0, 0)'

async function transformOf(page: Page, testId: string): Promise<string> {
  return page.getByTestId(testId).evaluate((el) => getComputedStyle(el).transform)
}

test('each person ends up holding both photos', async ({ browser }) => {
  const { a, b } = await connectedPair(browser)
  await pressReady(a)
  await pressReady(b)

  for (const page of [a, b]) {
    await expect(page.getByRole('heading', { name: 'LOOK WHAT YOU MADE.' })).toBeVisible({ timeout: 30_000 })
    for (const alt of ['Your photo', 'Their photo']) {
      const img = page.getByRole('img', { name: alt })
      await expect(img).toBeVisible()
      expect(await img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0)
    }
  }
})

test('preview matches result: a mirrored camera flips both frames and the capture', async ({ browser }) => {
  const { a, b } = await connectedPair(browser)
  // Chromium's fake camera reports no facingMode, which the app treats as a front camera: mirrored.
  expect(await transformOf(a, 'local-video')).toBe(FLIPPED)
  expect(await transformOf(a, 'remote-video')).toBe(FLIPPED) // THEM mirrored too (default / cam message)
  expect(await transformOf(b, 'local-video')).toBe(FLIPPED)

  await pressReady(a)
  await pressReady(b)
  await expect.poll(() => lastCapture(a), { timeout: 15_000 }).toMatchObject({ mirrored: true })
  await expect.poll(() => lastCapture(b), { timeout: 15_000 }).toMatchObject({ mirrored: true })
})

test('preview matches result: a rear camera is not flipped, on the owner and on the partner (cam message)', async ({ browser }) => {
  const a = await newPlayer(browser)
  const b = await newPlayer(browser)
  // Make B's camera claim to be a rear camera before any app code runs.
  await b.addInitScript(() => {
    const original = MediaStreamTrack.prototype.getSettings
    MediaStreamTrack.prototype.getSettings = function (this: MediaStreamTrack) {
      return { ...original.call(this), facingMode: 'environment' }
    }
  })
  const url = await createBooth(a)
  await enterBooth(a)
  await b.goto(url)
  await enterBooth(b)
  await expectRemoteVideo(a)
  await expectRemoteVideo(b)

  expect(await transformOf(b, 'local-video')).toBe('none') // B sees themself un-flipped
  await expect.poll(() => transformOf(a, 'remote-video')).toBe('none') // A's THEM frame follows B's `cam` message
  expect(await transformOf(a, 'local-video')).toBe(FLIPPED) // A is still a front camera

  await pressReady(a)
  await pressReady(b)
  await expect.poll(() => lastCapture(b), { timeout: 15_000 }).toMatchObject({ mirrored: false })
  await expect.poll(() => lastCapture(a), { timeout: 15_000 }).toMatchObject({ mirrored: true })
})
