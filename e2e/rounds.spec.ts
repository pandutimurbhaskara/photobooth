import { expect, test, type Page } from '@playwright/test'
import { closePlayers, createBooth, enterBooth, expectRemoteVideo, newPlayer, pressReady } from './helpers'

test.afterEach(closePlayers)

/**
 * Delays the server's capture-scheduling frames for one page, so that page receives them *after* the shared moment —
 * a slow phone or a throttled tab. Everything else (pongs, signaling, keepalive replies) passes straight through.
 */
async function delayCaptureFrames(page: Page, state: { ms: number }): Promise<void> {
  await page.routeWebSocket(/\/api\/rooms\/[^/]+\/ws/, (ws) => {
    const server = ws.connectToServer()
    ws.onMessage((m) => server.send(m))
    ws.onClose((code, reason) => void server.close({ code, reason }))
    server.onMessage((m) => {
      const isCaptureFrame = typeof m === 'string' && /"type":"capture-scheduled"|"phase":"capture"/.test(m)
      if (isCaptureFrame && state.ms > 0) setTimeout(() => ws.send(m), state.ms)
      else ws.send(m)
    })
    server.onClose((code, reason) => void ws.close({ code, reason }))
  })
}

// Final review I1: a missed round used to wipe its own warning and strand both people with no controls.
test('a capture message that arrives far too late shows MISSED IT, and the round recovers for both people', async ({ browser }) => {
  test.setTimeout(150_000)
  const a = await newPlayer(browser)
  const b = await newPlayer(browser)
  const slow = { ms: 7000 } // lead is 4.5 s and the grace period 1.5 s, so 7 s is hopelessly late
  await delayCaptureFrames(b, slow)

  const url = await createBooth(a)
  await enterBooth(a)
  await b.goto(url)
  await enterBooth(b)
  await expectRemoteVideo(a)
  await expectRemoteVideo(b)

  await pressReady(a)
  await pressReady(b)

  // B hears about the round after it is over: it must say so, and keep saying so (the replayed room-state used to wipe it).
  await expect(b.getByText('MISSED IT')).toBeVisible({ timeout: 20_000 })
  await b.waitForTimeout(1000)
  await expect(b.getByText('MISSED IT')).toBeVisible()

  // A captured on time and is waiting for a photo that will never come. The server gives up after 30 s.
  await expect(a.getByText('WAITING FOR THE PHOTOS...')).toBeVisible()
  await expect(a.getByText("THAT ROUND DIDN'T WORK")).toBeVisible({ timeout: 60_000 }) // a clear, recoverable message …
  await expect(a.getByText('CAMERA CONNECTION FAILED')).toHaveCount(0) // … not a misleading network error
  await expect(a.getByRole('button', { name: /i'm ready/i })).toBeEnabled()
  await expect(b.getByRole('button', { name: /i'm ready/i })).toBeEnabled()

  // Both go again, this time with normal delivery, and it works.
  slow.ms = 0
  await pressReady(a)
  await pressReady(b)
  for (const page of [a, b]) {
    await expect(page.getByRole('heading', { name: 'LOOK WHAT YOU MADE.' })).toBeVisible({ timeout: 30_000 })
  }
})

// Final review I4: a finished strip must never be hidden behind a connection-failure screen.
test('the finished strip stays reachable when the partner connection dies without the socket closing', async ({ browser }) => {
  test.setTimeout(120_000)
  const a = await newPlayer(browser)
  const b = await newPlayer(browser)
  // Keep a handle on B's peer connections so the test can kill the call while B's WebSocket stays open.
  await b.addInitScript(() => {
    const Native = window.RTCPeerConnection
    const pcs: RTCPeerConnection[] = []
    ;(window as unknown as { __pcs: RTCPeerConnection[] }).__pcs = pcs
    window.RTCPeerConnection = class extends Native {
      constructor(...args: ConstructorParameters<typeof Native>) {
        super(...args)
        pcs.push(this)
      }
    }
  })
  const url = await createBooth(a)
  await enterBooth(a)
  await b.goto(url)
  await enterBooth(b)
  await expectRemoteVideo(a)
  await expectRemoteVideo(b)

  await pressReady(a)
  await pressReady(b)
  const strip = a.getByRole('img', { name: 'Photo strip' })
  await expect(strip).toBeVisible({ timeout: 30_000 })

  await b.evaluate(() => (window as unknown as { __pcs: RTCPeerConnection[] }).__pcs.forEach((pc) => pc.close()))

  // A's peer connection fails after a while; the server still thinks B is connected (its socket is open).
  await expect(a.getByText(/CONNECTION (LOST|FAILED)/)).toBeVisible({ timeout: 60_000 })
  await expect(strip).toBeVisible()
  await expect(a.getByRole('button', { name: 'DOWNLOAD PHOTO' })).toBeEnabled()
  const [download] = await Promise.all([a.waitForEvent('download'), a.getByRole('button', { name: 'DOWNLOAD PHOTO' }).click()])
  expect(download.suggestedFilename()).toMatch(/\.png$/)
})
