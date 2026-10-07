import { expect, test, type Page } from '@playwright/test'
import { closePlayers, connectedPair, createBooth, enterBooth, expectRemoteVideo, newPlayer } from './helpers'

test.afterEach(closePlayers)

/** The error name must travel as an argument: addInitScript serializes only the function, so a closed-over variable would not exist in the page. */
async function denyCamera(page: Page, errorName: string): Promise<void> {
  await page.addInitScript((name) => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('nope', name))
  }, errorName)
}

test('camera blocked shows the brief copy and lets you try again', async ({ browser }) => {
  const page = await newPlayer(browser)
  await createBooth(page)
  await denyCamera(page, 'NotAllowedError')
  await page.reload()
  await enterBooth(page)
  await expect(page.getByText('CAMERA BLOCKED')).toBeVisible()
  await expect(page.getByText('WE NEED CAMERA ACCESS TO USE THE BOOTH.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'TRY AGAIN' })).toBeVisible()
})

test('no camera, and no camera API, each get their own message', async ({ browser }) => {
  const missing = await newPlayer(browser)
  await createBooth(missing)
  await denyCamera(missing, 'NotFoundError')
  await missing.reload()
  await enterBooth(missing)
  await expect(missing.getByText('NO CAMERA FOUND')).toBeVisible()

  const insecure = await newPlayer(browser)
  await createBooth(insecure)
  await insecure.addInitScript(() => Object.defineProperty(navigator, 'mediaDevices', { value: undefined }))
  await insecure.reload()
  await enterBooth(insecure)
  await expect(insecure.getByText('CAMERA NEEDS HTTPS')).toBeVisible()
})

test('when the partner leaves you are told, and their slot stays reserved against strangers', async ({ browser }) => {
  const { a, b, url } = await connectedPair(browser)
  await b.close()
  await expect(a.getByText('THEY LEFT :(')).toBeVisible()
  await expect(a.getByText('WAITING FOR THEM TO COME BACK.')).toBeVisible()
  await expect(a.getByText('WAITING FOR YOUR PERSON...')).toBeVisible()
  const stranger = await newPlayer(browser)
  await stranger.goto(url) // a brand-new person: the leaver's slot is reserved for them for the grace period
  await expect(stranger.getByText('BOOTH FULL.')).toBeVisible()
})

test('the leaver can come back (same tab storage) and both see video again', async ({ browser }) => {
  const { a, b } = await connectedPair(browser)
  await b.reload()
  await enterBooth(b)
  await expectRemoteVideo(a)
  await expectRemoteVideo(b)
})

test('opening the same booth as the same person in a second tab replaces the first', async ({ browser }) => {
  const first = await newPlayer(browser)
  const url = await createBooth(first)
  await enterBooth(first)
  const code = url.split('/b/')[1] ?? ''
  const id = await first.evaluate((c) => sessionStorage.getItem(`booth:pid:${c}`), code)
  expect(id).toBeTruthy()

  const second = await newPlayer(browser)
  await second.addInitScript(([c, v]) => sessionStorage.setItem(`booth:pid:${c}`, v as string), [code, id])
  await second.goto(url)
  await enterBooth(second)

  await expect(first.getByText('OPENED ELSEWHERE.')).toBeVisible()
  await expect(second.getByText('WAITING FOR YOUR PERSON...')).toBeVisible()
})
