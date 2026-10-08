import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { closePlayers, connectedPair, finishSession, keepCell, shootCell } from './helpers'

test.afterEach(closePlayers)

// The fake camera plays a real photograph of a person (public domain, see fixtures/README.md) as a looping MJPEG, so
// the real cutout model sees a real human. With Chromium's default test pattern there is nobody to cut out.
const mjpeg = join(mkdtempSync(join(tmpdir(), 'two-up-')), 'person.mjpeg')
const portrait = readFileSync('e2e/fixtures/portrait.jpg')
writeFileSync(mjpeg, Buffer.concat(Array.from({ length: 30 }, () => portrait)))
test.use({
  launchOptions: {
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-video-capture=${mjpeg}`],
  },
})

const strip = (page: Page) => page.getByRole('img', { name: 'Photo strip' })

/** Pixels of the finished strip as [r, g, b] triples at the given points. */
const pixels = (page: Page, at: Array<[number, number]>) =>
  strip(page).evaluate(async (img: HTMLImageElement, points: Array<[number, number]>) => {
    await img.decode()
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(img, 0, 0)
    return points.map(([x, y]) => Array.from(ctx.getImageData(x, y, 1, 1).data.slice(0, 3)))
  }, at)

test('choosing a background puts both people on it, and the strip downloads', async ({ browser }) => {
  test.setTimeout(240_000)
  const { a, b } = await connectedPair(browser)
  await finishSession(a, b, 'polaroid') // one TOGETHER cell
  const before = await strip(a).getAttribute('src')

  await a.getByRole('radio', { name: 'YELLOW' }).click()
  await expect.poll(() => strip(a).getAttribute('src'), { timeout: 90_000 }).not.toBe(before)

  // The cell starts at x = 48. A person's box is at most 55 % of the cell wide and centred at 30 % / 70 %, so it can
  // never start before 24 px into the cell: 12 px in, at mid-height, only the background shows — yellow #ffe600.
  const [corner] = await pixels(a, [[60, 408]])
  expect(corner).toEqual([255, 230, 0])
  // …and the people really are there: along the bottom of the cell, most pixels are the white suit, not the background.
  const bottom = await pixels(a, Array.from({ length: 15 }, (_, i): [number, number] => [48 + 140 + i * 45, 48 + 690]))
  expect(bottom.filter(([r, g, bl]) => !(r === 255 && g === 230 && bl === 0)).length).toBeGreaterThanOrEqual(8)
  expect(await strip(a).evaluate((el: HTMLImageElement) => [el.naturalWidth, el.naturalHeight])).toEqual([1056, 1032])

  const [download] = await Promise.all([a.waitForEvent('download'), a.getByRole('button', { name: 'DOWNLOAD PHOTO' }).click()])
  expect(download.suggestedFilename()).toMatch(/\.png$/)

  // Style is per person: B is unaffected.
  await expect(b.getByRole('radio', { name: 'SIDE BY SIDE' })).toBeChecked()
  await expect(a.getByText('CUTOUTS ARE MADE ON YOUR DEVICE.')).toBeVisible()
})

// Review Focus 5: the cutout tool cannot load.
test("if the cutout tool can't load, the cell falls back to side by side and download still works", async ({ browser }) => {
  test.setTimeout(240_000)
  const { a, b } = await connectedPair(browser)
  await finishSession(a, b, 'polaroid')
  const before = await strip(a).getAttribute('src')

  await a.route('**/vendor/**', (route) => route.abort()) // the model and the WASM are unreachable
  await a.getByRole('radio', { name: 'YELLOW' }).click()

  await expect(a.getByText("COULDN'T CUT YOU OUT. SHOWING SIDE BY SIDE.")).toBeVisible({ timeout: 60_000 })
  expect(await strip(a).getAttribute('src')).toBe(before) // the strip is still the side-by-side one
  await expect(a.getByRole('button', { name: 'DOWNLOAD PHOTO' })).toBeEnabled()
  const [download] = await Promise.all([a.waitForEvent('download'), a.getByRole('button', { name: 'DOWNLOAD PHOTO' }).click()])
  expect(download.suggestedFilename()).toMatch(/\.png$/)

  // Review I3: the network comes back, and choosing another background must try again (not sit on the old failure).
  await a.unroute('**/vendor/**')
  await a.getByRole('radio', { name: 'PINK' }).click()
  await expect(a.getByText("COULDN'T CUT YOU OUT. SHOWING SIDE BY SIDE.")).toHaveCount(0, { timeout: 60_000 })
  await expect.poll(() => strip(a).getAttribute('src'), { timeout: 60_000 }).not.toBe(before)
  const [pink] = await pixels(a, [[60, 408]])
  expect(pink).toEqual([255, 79, 163])
})

test('a strip with no TOGETHER cell does not offer a background', async ({ browser }) => {
  test.setTimeout(240_000)
  const { a, b } = await connectedPair(browser)
  await a.getByRole('radio', { name: /polaroid/i }).click()
  await a.getByRole('group', { name: /cell 1/i }).getByRole('radio', { name: /user 1/i }).click()
  await expect(b.getByRole('group', { name: /cell 1/i }).getByRole('radio', { name: /user 1/i })).toBeChecked()
  // Shoot the one cell as USER 1 only, keep it, and look at the finished screen.
  await shootCell(a, b)
  await keepCell(a, b)
  await expect(a.getByRole('heading', { name: 'LOOK WHAT YOU MADE.' })).toBeVisible({ timeout: 30_000 })
  await expect(a.getByRole('radio', { name: 'YELLOW' })).toHaveCount(0)
})
