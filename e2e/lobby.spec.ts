import { expect, test } from '@playwright/test'
import { closePlayers, createBooth, enterBooth, newPlayer } from './helpers'

test.afterEach(closePlayers)

test('the lobby shows the code, copies the link and shows a QR code', async ({ browser }) => {
  const a = await newPlayer(browser)
  const url = await createBooth(a)
  await enterBooth(a)
  const code = url.split('/b/')[1] ?? ''

  await expect(a.getByText('WAITING FOR YOUR PERSON...')).toBeVisible()
  await expect(a.getByText(`Room code ${code.split('').join(' ')}`)).toBeAttached() // spoken form for screen readers
  await expect(a.getByText(`${code.slice(0, 3)} ${code.slice(3)}`, { exact: true })).toBeVisible() // 3 + 3 on screen

  await a.getByRole('button', { name: 'COPY LINK' }).click()
  await expect(a.getByText('LINK COPIED')).toBeVisible()
  expect(await a.evaluate(() => navigator.clipboard.readText())).toBe(url)

  await a.getByRole('button', { name: 'QR CODE' }).click()
  const dialog = a.getByRole('dialog')
  await expect(dialog).toBeVisible()
  const qr = dialog.getByRole('img', { name: 'QR code for this booth' })
  await expect(qr).toBeVisible()
  expect(await qr.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(100)
  await a.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
})

test('the camera gate carries the privacy copy', async ({ browser }) => {
  const a = await newPlayer(browser)
  await createBooth(a)
  await expect(a.getByText(/YOUR CAMERA STAYS IN YOUR BROWSER/)).toBeVisible()
  await expect(a.getByText(/PHOTOS ARE PROCESSED\s+LOCALLY UNLESS YOU CHOOSE TO SAVE OR SHARE THEM/)).toBeVisible()
})
