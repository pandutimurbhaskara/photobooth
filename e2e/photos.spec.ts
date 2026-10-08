import { expect, test, type Page } from '@playwright/test'
import {
  chooseTemplate,
  closePlayers,
  connectedPair,
  createBooth,
  enterBooth,
  expectRemoteVideo,
  finishSession,
  lastCapture,
  newPlayer,
  pressReady,
} from './helpers'

test.afterEach(closePlayers)

const FLIPPED = 'matrix(-1, 0, 0, 1, 0, 0)'

async function transformOf(page: Page, testId: string): Promise<string> {
  return page.getByTestId(testId).evaluate((el) => getComputedStyle(el).transform)
}

test('each person gets a photo strip with both photos, and can download it as PNG and JPG', async ({ browser }) => {
  test.setTimeout(150_000)
  const { a, b } = await connectedPair(browser)
  await finishSession(a, b, 'duo2')

  for (const page of [a, b]) {
    const strip = page.getByRole('img', { name: 'Photo strip' })
    await expect(strip).toBeVisible()
    expect(await strip.evaluate((el: HTMLImageElement) => [el.naturalWidth, el.naturalHeight])).toEqual([1056, 1800])
  }

  const [pngDownload] = await Promise.all([a.waitForEvent('download'), a.getByRole('button', { name: 'DOWNLOAD PHOTO' }).click()])
  expect(pngDownload.suggestedFilename()).toMatch(/^two-up-[A-HJ-KM-NP-Z2-9]{6}-duo2\.png$/)

  await a.getByRole('radio', { name: 'JPG' }).click()
  const [jpgDownload] = await Promise.all([a.waitForEvent('download'), a.getByRole('button', { name: 'DOWNLOAD PHOTO' }).click()])
  expect(jpgDownload.suggestedFilename()).toMatch(/\.jpg$/)
})

test('a Polaroid is 1056 × 1032', async ({ browser }) => {
  test.setTimeout(150_000)
  const { a, b } = await connectedPair(browser)
  await finishSession(a, b, 'polaroid')
  expect(
    await a.getByRole('img', { name: 'Photo strip' }).evaluate((el: HTMLImageElement) => [el.naturalWidth, el.naturalHeight]),
  ).toEqual([1056, 1032])
})

// The 4-cut size (1056 × 3336) is asserted at unit level in photo.test.ts; an 8-take e2e run for it would only add minutes.
test('a 2 × 2 card is 2064 × 1800', async ({ browser }) => {
  test.setTimeout(300_000)
  const { a, b } = await connectedPair(browser)
  await finishSession(a, b, 'grid4')
  expect(
    await a.getByRole('img', { name: 'Photo strip' }).evaluate((el: HTMLImageElement) => [el.naturalWidth, el.naturalHeight]),
  ).toEqual([2064, 1800])
})

test('the strip stays downloadable after the partner leaves', async ({ browser }) => {
  test.setTimeout(150_000)
  const { a, b } = await connectedPair(browser)
  await finishSession(a, b, 'duo2')
  await expect(a.getByRole('img', { name: 'Photo strip' })).toBeVisible({ timeout: 30_000 })
  await b.close()
  await expect(a.getByText(/THEY LEFT/)).toBeVisible()
  await expect(a.getByRole('button', { name: 'DOWNLOAD PHOTO' })).toBeEnabled()
})

test('preview matches result: a mirrored camera flips both frames and the capture', async ({ browser }) => {
  const { a, b } = await connectedPair(browser)
  // Chromium's fake camera reports no facingMode, which the app treats as a front camera: mirrored.
  expect(await transformOf(a, 'local-video')).toBe(FLIPPED)
  expect(await transformOf(a, 'remote-video')).toBe(FLIPPED) // THEM mirrored too (default / cam message)
  expect(await transformOf(b, 'local-video')).toBe(FLIPPED)

  await chooseTemplate(a, 'duo2')
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

  await chooseTemplate(a, 'duo2')
  await pressReady(a)
  await pressReady(b)
  await expect.poll(() => lastCapture(b), { timeout: 15_000 }).toMatchObject({ mirrored: false })
  await expect.poll(() => lastCapture(a), { timeout: 15_000 }).toMatchObject({ mirrored: true })
})

test('a filter re-renders the strip; B&W really is greyscale', async ({ browser }) => {
  test.setTimeout(150_000)
  const { a, b } = await connectedPair(browser)
  await finishSession(a, b, 'duo2')
  const strip = a.getByRole('img', { name: 'Photo strip' })
  await expect(strip).toBeVisible({ timeout: 30_000 })
  const before = await strip.getAttribute('src')

  await a.getByRole('radio', { name: 'B&W' }).check()
  await expect.poll(() => strip.getAttribute('src')).not.toBe(before)

  // Sample a few pixels from inside the first photo cell (x 48..1008, y 48..768) of the 1056x1800 strip.
  const greyscale = await strip.evaluate(async (img: HTMLImageElement) => {
    await img.decode()
    const c = document.createElement('canvas')
    c.width = img.naturalWidth
    c.height = img.naturalHeight
    const ctx = c.getContext('2d')!
    ctx.drawImage(img, 0, 0)
    return [[300, 300], [528, 408], [700, 500], [900, 650]].every(([x, y]) => {
      const [r, g, bl] = ctx.getImageData(x!, y!, 1, 1).data
      return Math.abs(r! - g!) <= 1 && Math.abs(g! - bl!) <= 1
    })
  })
  expect(greyscale).toBe(true)
})
