import { expect, test } from '@playwright/test'
import { chooseTemplate, closePlayers, connectedPair, pressReady } from './helpers'

test.afterEach(closePlayers)

test('READY waits for a format, and either person can choose it for both', async ({ browser }) => {
  const { a, b } = await connectedPair(browser)
  for (const page of [a, b]) {
    await expect(page.getByRole('heading', { name: 'PICK A FORMAT' })).toBeVisible()
    await expect(page.getByRole('listitem').filter({ hasText: 'FORMAT' })).toHaveAttribute('aria-current', 'step')
    await expect(page.getByRole('button', { name: /i'm ready/i })).toBeDisabled()
  }

  await chooseTemplate(b, 'grid4') // the joiner picks: either of them can
  await expect(a.getByRole('radio', { name: /2 × 2/ })).toBeChecked()
  await expect(a.getByRole('group', { name: /cell 4/i })).toBeVisible()
  await expect(a.getByRole('button', { name: /i'm ready/i })).toBeEnabled()
})

test('each cell can be USER 1, USER 2 or TOGETHER, and both screens agree', async ({ browser }) => {
  const { a, b } = await connectedPair(browser)
  await chooseTemplate(a, 'duo2')
  await b.getByRole('group', { name: /cell 2/i }).getByRole('radio', { name: /user 1/i }).click()
  await expect(a.getByRole('group', { name: /cell 2/i }).getByRole('radio', { name: /user 1/i })).toBeChecked()
  await expect(a.getByRole('group', { name: /cell 1/i }).getByRole('radio', { name: /together/i })).toBeChecked()
  // Slot a is USER 1: it is marked as you on A's screen and not on B's.
  await expect(a.getByRole('radio', { name: 'USER 1 (YOU)' }).first()).toBeVisible()
  await expect(b.getByRole('radio', { name: 'USER 2 (YOU)' }).first()).toBeVisible()
})

// Review Focus 1: nobody stays committed to a plan they did not see.
test('changing the format clears a READY that was already pressed', async ({ browser }) => {
  const { a, b } = await connectedPair(browser)
  await chooseTemplate(a, 'duo2')
  await pressReady(a)
  await expect(a.getByText('YOU READY ✓')).toBeVisible()
  await expect(b.getByText('THEM READY ✓')).toBeVisible()

  await chooseTemplate(b, 'polaroid')
  await expect(a.getByText('YOU NOT READY')).toBeVisible()
  await expect(b.getByText('THEM WAITING...')).toBeVisible()
})
