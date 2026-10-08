import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { closePlayers, newPlayer } from './helpers'

test.afterEach(closePlayers)

type CutOut = (photo: Blob) => Promise<{ canvas: HTMLCanvasElement; bounds: { x: number; y: number; w: number; h: number } }>

// A real photograph of a person (public domain, see fixtures/README.md): the model does not recognise a drawing.
test('the self-hosted segmenter keeps the person and drops the background', async ({ browser }) => {
  test.setTimeout(120_000)
  const portrait = readFileSync('e2e/fixtures/portrait.jpg').toString('base64')
  const page = await newPlayer(browser)
  await page.goto('/')
  const result = await page.evaluate(async (data: string) => {
    const url = '/src/client/lib/segment.ts' // served by the Vite dev server
    const { cutOut } = (await import(/* @vite-ignore */ url)) as { cutOut: CutOut }
    const photo = new Blob([Uint8Array.from(atob(data), (c) => c.charCodeAt(0))], { type: 'image/jpeg' })
    const cut = await cutOut(photo)
    const ctx = cut.canvas.getContext('2d')!
    const alphaAt = (x: number, y: number) => ctx.getImageData(x, y, 1, 1).data[3]
    return {
      width: cut.canvas.width,
      height: cut.canvas.height,
      bounds: cut.bounds,
      corner: alphaAt(4, 4), // the moon backdrop, top-left
      suit: alphaAt(640, 800), // the white suit
    }
  }, portrait)

  expect([result.width, result.height]).toEqual([960, 1200])
  expect(result.corner).toBe(0) // the background is transparent …
  expect(result.suit).toBe(255) // … and the person is opaque, not the other way round
  expect(result.bounds.w).toBeGreaterThan(600)
  expect(result.bounds.y + result.bounds.h).toBeGreaterThan(1150) // he is cut off by the bottom of the photo
})
