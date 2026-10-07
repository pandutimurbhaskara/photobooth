import { expect, test } from '@playwright/test'
import { closePlayers, connectedPair, lastCapture, pressReady } from './helpers'

test.afterEach(closePlayers)

test('both browsers capture the same round at essentially the same moment', async ({ browser }) => {
  const { a, b } = await connectedPair(browser)
  await pressReady(a)
  await expect(a.getByText('YOU READY ✓')).toBeVisible()
  await pressReady(b)

  await expect(a.getByTestId('countdown')).toBeVisible()
  await expect(b.getByTestId('countdown')).toBeVisible()
  await expect(a.getByTestId('countdown')).toContainText('BOTH READY. GET READY.')

  await expect.poll(() => lastCapture(a), { timeout: 15_000 }).not.toBeNull()
  await expect.poll(() => lastCapture(b), { timeout: 15_000 }).not.toBeNull()
  const [ca, cb] = await Promise.all([lastCapture(a), lastCapture(b)])
  expect(ca?.round).toBe(1)
  expect(cb?.round).toBe(1)
  // Same machine ⇒ same wall clock ⇒ this measures real simultaneity, not just agreement on a timestamp.
  expect(Math.abs((ca?.wallAt ?? 0) - (cb?.wallAt ?? 0))).toBeLessThan(150)
})

test('a second round can follow the first', async ({ browser }) => {
  const { a, b } = await connectedPair(browser)
  await pressReady(a)
  await pressReady(b)
  await expect(a.getByRole('heading', { name: 'LOOK WHAT YOU MADE.' })).toBeVisible({ timeout: 30_000 })
  await expect(b.getByRole('heading', { name: 'LOOK WHAT YOU MADE.' })).toBeVisible({ timeout: 30_000 })
  expect(await lastCapture(a)).toMatchObject({ round: 1 })

  await a.getByRole('button', { name: 'RETAKE' }).click() // enabled once the server is back in `ready`
  await b.getByRole('button', { name: 'RETAKE' }).click()
  await expect.poll(() => lastCapture(a), { timeout: 20_000 }).toMatchObject({ round: 2 })
  await expect.poll(() => lastCapture(b), { timeout: 20_000 }).toMatchObject({ round: 2 })
})

test('leaving during the countdown cancels the capture', async ({ browser }) => {
  const { a, b } = await connectedPair(browser)
  await pressReady(a)
  await pressReady(b)
  await expect(a.getByTestId('countdown')).toBeVisible()

  await b.close()
  await expect(a.getByText('WAITING FOR YOUR PERSON...')).toBeVisible()
  await a.waitForTimeout(6000) // longer than the 4.5 s lead: the cancelled round must not fire
  expect(await lastCapture(a)).toBeNull()
})
