import { expect, test } from '@playwright/test'
import { chooseTemplate, closePlayers, connectedPair, keepCell, pressReady, shootCell } from './helpers'

test.afterEach(closePlayers)

test('two takes, then either person changes the pick for both, and the strip is built from the kept takes', async ({ browser }) => {
  test.setTimeout(120_000)
  const { a, b } = await connectedPair(browser)
  await chooseTemplate(a, 'polaroid')

  await pressReady(a)
  await pressReady(b)
  for (const page of [a, b]) await expect(page.getByText(/CELL 1 OF 1 · TAKE 2/)).toBeVisible({ timeout: 30_000 })
  await pressReady(a)
  await pressReady(b)

  for (const page of [a, b]) {
    await expect(page.getByRole('button', { name: /keep this one/i })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('button', { name: /take 2, kept/i })).toBeVisible() // the newest is preselected
  }
  await a.getByRole('button', { name: /^take 1$/i }).click()
  await expect(b.getByRole('button', { name: /take 1, kept/i })).toBeVisible()
  await expect(b.getByRole('button', { name: /take 2, kept/i })).toHaveCount(0)

  await keepCell(a, b)
  for (const page of [a, b]) {
    await expect(page.getByRole('heading', { name: 'LOOK WHAT YOU MADE.' })).toBeVisible({ timeout: 30_000 })
    const strip = page.getByRole('img', { name: 'Photo strip' })
    await expect(strip).toBeVisible()
    expect(await strip.evaluate((el: HTMLImageElement) => [el.naturalWidth, el.naturalHeight])).toEqual([1056, 1032])
  }
})

test('ONE MORE TAKE adds a third, and is then refused', async ({ browser }) => {
  test.setTimeout(120_000)
  const { a, b } = await connectedPair(browser)
  await chooseTemplate(a, 'polaroid')
  await shootCell(a, b)

  await expect(a.getByRole('button', { name: /one more take/i })).toBeEnabled()
  await a.getByRole('button', { name: /one more take/i }).click()
  for (const page of [a, b]) await expect(page.getByText(/CELL 1 OF 1 · TAKE 3/)).toBeVisible()

  await pressReady(a)
  await pressReady(b)
  for (const page of [a, b]) {
    await expect(page.getByRole('button', { name: /take 3, kept/i })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('button', { name: /one more take/i })).toBeDisabled()
  }
})

test('CHANGE FORMAT goes away once a take exists', async ({ browser }) => {
  const { a, b } = await connectedPair(browser)
  await chooseTemplate(a, 'duo2')
  await pressReady(a)
  await pressReady(b)
  for (const page of [a, b]) await expect(page.getByText(/CELL 1 OF 2 · TAKE 2/)).toBeVisible({ timeout: 30_000 })
  await expect(a.getByRole('button', { name: 'CHANGE FORMAT' })).toHaveCount(0) // a take exists now
})
