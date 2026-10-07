import { expect, test } from '@playwright/test'
import { createBooth, enterBooth, expectRemoteVideo, newPlayer } from './helpers'

test('two people see each other over real WebRTC', async ({ browser }) => {
  const a = await newPlayer(browser)
  const b = await newPlayer(browser)

  const url = await createBooth(a)
  await enterBooth(a)
  await expect(a.getByText('WAITING FOR YOUR PERSON...')).toBeVisible()

  await b.goto(url)
  await enterBooth(b)

  await expectRemoteVideo(a)
  await expectRemoteVideo(b)
  await expect(a.getByText('● CONNECTED')).toBeVisible()
  await expect(b.getByText('● CONNECTED')).toBeVisible()
})

test('a third person is told the booth is full before any camera prompt', async ({ browser }) => {
  const a = await newPlayer(browser)
  const b = await newPlayer(browser)
  const c = await newPlayer(browser)
  const url = await createBooth(a)
  await enterBooth(a)
  await b.goto(url)
  await enterBooth(b)
  await expectRemoteVideo(a)

  await c.goto(url)
  await expect(c.getByText('BOOTH FULL.')).toBeVisible()
  await expect(c.getByRole('link', { name: /create new booth/i })).toBeVisible()
})

test('a code that was never created shows NO SUCH BOOTH', async ({ browser }) => {
  const a = await newPlayer(browser)
  await a.goto('/b/ZZZZZZ')
  await expect(a.getByText('NO SUCH BOOTH.')).toBeVisible()
})

test('reloading inside a full booth rejoins instead of being told it is full', async ({ browser }) => {
  const a = await newPlayer(browser)
  const b = await newPlayer(browser)
  const url = await createBooth(a)
  await enterBooth(a)
  await b.goto(url)
  await enterBooth(b)
  await expectRemoteVideo(a)

  await a.reload()
  await expect(a.getByText('BOOTH FULL.')).toHaveCount(0)
  await enterBooth(a)
  await expectRemoteVideo(a)
  await expectRemoteVideo(b)
})
