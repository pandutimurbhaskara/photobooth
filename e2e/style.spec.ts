import { expect, test } from '@playwright/test'
import { closePlayers, connectedPair, enterBooth, finishSession, keepCell, shootCell } from './helpers'

test.afterEach(closePlayers)

test('retaking one cell re-shoots only that cell, and the partner is told and can still save the old strip', async ({ browser }) => {
  test.setTimeout(240_000)
  const { a, b } = await connectedPair(browser)
  await finishSession(a, b, 'duo2')
  const strip = a.getByRole('img', { name: 'Photo strip' })
  await expect(strip).toBeVisible()
  const before = await strip.getAttribute('src')

  await expect(a.getByRole('heading', { name: 'NOT HAPPY WITH A CELL?' })).toBeVisible()
  await a.getByRole('button', { name: 'RETAKE 2' }).click()
  await expect(a.getByText('THIS REPLACES CELL 2.')).toBeVisible()
  await a.getByRole('button', { name: 'YES, RETAKE' }).click()

  // B is looking at the finished strip: it stays, with a notice and a way to join.
  await expect(b.getByText("THEY'RE RETAKING A CELL.")).toBeVisible()
  await expect(b.getByRole('button', { name: 'DOWNLOAD PHOTO' })).toBeEnabled()
  await b.getByRole('button', { name: 'JOIN THEM' }).click()

  for (const page of [a, b]) await expect(page.getByText(/CELL 2 OF 2 · TAKE 1/)).toBeVisible()
  await shootCell(a, b)
  await keepCell(a, b)
  for (const page of [a, b]) await expect(page.getByRole('heading', { name: 'LOOK WHAT YOU MADE.' })).toBeVisible({ timeout: 30_000 })
  await expect.poll(() => strip.getAttribute('src')).not.toBe(before)
})

// Review Focus 2: a reload loses this tab's photos; the partner's strip must survive the start-over.
test('a reloaded tab says its photos are gone, and starting over does not take the strip away from the partner', async ({ browser }) => {
  test.setTimeout(180_000)
  const { a, b, url } = await connectedPair(browser)
  await finishSession(a, b, 'polaroid')

  b.on('dialog', (dialog) => void dialog.accept()) // the "photos live only in this tab" beforeunload prompt
  await b.goto(url)
  await enterBooth(b)
  await expect(b.getByText('YOUR PHOTOS WERE LOST WHEN THIS PAGE RELOADED')).toBeVisible()
  await b.getByRole('button', { name: 'START OVER' }).click()

  await expect(a.getByText('THEY STARTED OVER. SAVE YOUR STRIP.')).toBeVisible()
  // Review I1: what A sees is now only a snapshot. RETAKE on it would be refused by the server *and* throw the
  // snapshot away, and A's store is empty, so closing the tab must still warn that the strip would be lost.
  await expect(a.getByRole('button', { name: 'RETAKE 1' })).toBeDisabled()
  expect(
    await a.evaluate(() => {
      const event = new Event('beforeunload', { cancelable: true })
      window.dispatchEvent(event)
      return event.defaultPrevented
    }),
  ).toBe(true)
  const [download] = await Promise.all([a.waitForEvent('download'), a.getByRole('button', { name: 'DOWNLOAD PHOTO' }).click()])
  expect(download.suggestedFilename()).toMatch(/\.png$/)
  await a.getByRole('button', { name: 'NEW STRIP' }).click()
  await expect(a.getByRole('heading', { name: 'PICK A FORMAT' })).toBeVisible()
})
