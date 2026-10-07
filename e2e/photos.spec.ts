import { expect, test, type Page } from '@playwright/test'
import { closePlayers, connectedPair, createBooth, enterBooth, expectRemoteVideo, lastCapture, newPlayer, pressReady } from './helpers'

test.afterEach(closePlayers)

const FLIPPED = 'matrix(-1, 0, 0, 1, 0, 0)'

async function transformOf(page: Page, testId: string): Promise<string> {
  return page.getByTestId(testId).evaluate((el) => getComputedStyle(el).transform)
}

test('each person gets a photo strip with both photos, and can download it as PNG and JPG', async ({ browser }) => {
  const { a, b } = await connectedPair(browser)
  await pressReady(a)
  await pressReady(b)

  for (const page of [a, b]) {
    await expect(page.getByRole('heading', { name: 'LOOK WHAT YOU MADE.' })).toBeVisible({ timeout: 30_000 })
    const strip = page.getByRole('img', { name: 'Photo strip' })
    await expect(strip).toBeVisible()
    expect(await strip.evaluate((el: HTMLImageElement) => [el.naturalWidth, el.naturalHeight])).toEqual([1056, 1800])
  }

  const [pngDownload] = await Promise.all([a.waitForEvent('download'), a.getByRole('button', { name: 'DOWNLOAD PHOTO' }).click()])
  expect(pngDownload.suggestedFilename()).toMatch(/^two-up-[A-HJ-KM-NP-Z2-9]{6}-1\.png$/)

  await a.getByRole('radio', { name: 'JPG' }).click()
  const [jpgDownload] = await Promise.all([a.waitForEvent('download'), a.getByRole('button', { name: 'DOWNLOAD PHOTO' }).click()])
  expect(jpgDownload.suggestedFilename()).toMatch(/\.jpg$/)
})

test('horizontal layout changes the strip size; grid unlocks after a second round', async ({ browser }) => {
  const { a, b } = await connectedPair(browser)
  await pressReady(a)
  await pressReady(b)
  await expect(a.getByRole('img', { name: 'Photo strip' })).toBeVisible({ timeout: 30_000 })
  await expect(a.getByRole('radio', { name: 'GRID' })).toBeDisabled()

  await a.getByRole('radio', { name: 'HORIZONTAL' }).click()
  await expect
    .poll(() => a.getByRole('img', { name: 'Photo strip' }).evaluate((el: HTMLImageElement) => el.naturalWidth))
    .toBe(2064)

  await a.getByRole('button', { name: 'RETAKE' }).click()
  await b.getByRole('button', { name: 'RETAKE' }).click()
  await expect(a.getByRole('radio', { name: 'GRID' })).toBeEnabled({ timeout: 30_000 })
  await a.getByRole('radio', { name: 'GRID' }).click()
  await expect
    .poll(() => a.getByRole('img', { name: 'Photo strip' }).evaluate((el: HTMLImageElement) => [el.naturalWidth, el.naturalHeight]))
    .toEqual([2064, 1800])
})

test('the strip stays downloadable after the partner leaves', async ({ browser }) => {
  const { a, b } = await connectedPair(browser)
  await pressReady(a)
  await pressReady(b)
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

test('a filter re-renders the strip; B&W really is greyscale', async ({ browser }) => {
  const { a, b } = await connectedPair(browser)
  await pressReady(a)
  await pressReady(b)
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
