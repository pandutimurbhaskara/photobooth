import { expect, test } from '@playwright/test'
import { closePlayers, createBooth, enterBooth, newPlayer } from './helpers'

test.afterEach(closePlayers)

test('joining accepts a sloppy code, a pasted URL, and refuses look-alike letters', async ({ browser }) => {
  const host = await newPlayer(browser)
  const url = await createBooth(host)
  await enterBooth(host)
  const code = url.split('/b/')[1] ?? ''
  expect(code).toHaveLength(6)

  const sloppy = await newPlayer(browser)
  await sloppy.goto('/')
  await sloppy.getByLabel('ENTER CODE').fill(`  ${code.slice(0, 3).toLowerCase()}-${code.slice(3).toLowerCase()} `)
  await sloppy.getByRole('button', { name: 'JOIN', exact: true }).click()
  await expect(sloppy).toHaveURL(new RegExp(`/b/${code}$`))

  const pasted = await newPlayer(browser)
  await pasted.goto('/join')
  await pasted.getByLabel('ENTER CODE').fill(url)
  await pasted.getByRole('button', { name: 'JOIN', exact: true }).click()
  await expect(pasted).toHaveURL(new RegExp(`/b/${code}$`))

  const wrong = await newPlayer(browser)
  await wrong.goto('/join')
  await wrong.getByLabel('ENTER CODE').fill('O0I1LL')
  await wrong.getByRole('button', { name: 'JOIN', exact: true }).click()
  await expect(wrong.getByText('THAT CODE LOOKS WRONG.')).toBeVisible()

  await wrong.getByLabel('ENTER CODE').fill('ZZZZZZ')
  await wrong.getByRole('button', { name: 'JOIN', exact: true }).click()
  await expect(wrong.getByText('NO BOOTH WITH THAT CODE.')).toBeVisible()
})
