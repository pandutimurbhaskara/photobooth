# Phase 3 — Cutover and end-to-end (Tasks 9–13)

> Part of `2026-10-08-wizard-flow.md`. **Read that master file first** (Global Constraints and Review Focus apply to every task here). Spec: `docs/superpowers/specs/2026-10-08-wizard-flow-design.md` §3, §6, §10.

**Phase goal:** the booth page runs the wizard end to end on two real browsers. Order is test first: Task 9 writes the new e2e helpers and the wizard spec (they fail, because the app is still the old flow); Task 10 replaces `Booth.tsx` and deletes the old screens until that spec passes; Tasks 11–12 move every other Playwright spec to the wizard and add the specs for Pick and Done; Task 13 updates the README and runs the full gate.

**How the e2e suite is run:** `npx playwright test e2e/<file>.spec.ts` starts its own dev server on port 5199 (`playwright.config.ts`), uses Chromium's fake camera, one worker. First time on a machine: `npm run e2e:install`. A whole spec file is minutes, not seconds — run only the file you are working on until the final gate.

**If a spec fails with a multi-minute gap in its timeline** (one `expect` that "took" 3 minutes, a camera that suddenly reports "not found"), the machine stalled — a laptop napping a background process does this to long Playwright runs. It is not the app. Re-run that spec on its own (`npx playwright test e2e/<file> -g "<title>"`); if it passes alone, say so in the report and move on. A failure that repeats alone is real.

**Gate (Phase 3, all must pass):**
1. `npm run check` — typecheck (`wrangler types && tsc -b`, which includes `e2e/`), lint, unit + worker tests.
2. `npm run build`.
3. `npm run test:e2e` — every spec green.

Between Tasks 9 and 12 `e2e/` does not type-check (specs not yet migrated still import helpers that no longer exist). Use `npx tsc -p tsconfig.client.json --noEmit && npx tsc -p tsconfig.worker.json --noEmit` for the app until Task 12.

---

## Task 9: E2E helpers and the wizard spec (written first — it fails against the old app)

**Files:**
- Modify (rewrite): `e2e/helpers.ts`
- Create: `e2e/wizard.spec.ts`

**Interfaces:**
- Consumes: the UI contract of Phase 2: screen titles (`Send this code to your partner`, `Pick a size`, `Allow your camera`, `Ready to shoot?`, `Pick your favorites`, `Pick a look`, `All done!`), buttons (`Next`, `Back`, `Allow camera`, `I'm ready`, `Download`, `Make another`, stepper buttons named `<Step> (go back)`), `data-testid` `local-video` / `remote-video` / `countdown`.
- Produces (`e2e/helpers.ts`), used by every later spec:
  ```ts
  export const BASE: string
  export function closePlayers(): Promise<void>
  export function newPlayer(browser: Browser, opts?: { viewport?: { width: number; height: number }; reducedMotion?: 'reduce' | 'no-preference' }): Promise<Page>
  export function createBooth(page: Page): Promise<string>            // lands on the room-code screen; returns the booth URL
  export const codeOf: (url: string) => string
  export const heading: (page: Page, title: string | RegExp) => Locator   // the page's <h1>
  export function expectStep(pages: Page[], title: string | RegExp, timeout?: number): Promise<void>
  export function roomPair(browser: Browser): Promise<{ a: Page; b: Page; url: string }>   // both on Frame, no camera asked
  export const FRAMES: { strip4: 4; grid4: 4; duo2: 2; polaroid: 1 }
  export type TemplateKey = keyof typeof FRAMES
  export function chooseTemplate(page: Page, template: TemplateKey): Promise<void>
  export function nextStep(page: Page): Promise<void>
  export function backStep(page: Page): Promise<void>
  export function allowCamera(page: Page): Promise<void>
  export function toShoot(a: Page, b: Page, template?: TemplateKey): Promise<void>        // choose + Next; both on the camera prompt
  export function bothCamerasOn(a: Page, b: Page): Promise<void>                          // allow, and each sees the other's video
  export function shootPair(browser: Browser, template?: TemplateKey): Promise<{ a: Page; b: Page; url: string }>
  export function expectRemoteVideo(page: Page): Promise<void>
  export function pressReady(page: Page): Promise<void>
  export function shootSequence(a: Page, b: Page): Promise<void>                          // one ready each → both end on Pick
  export function finishSession(a: Page, b: Page): Promise<void>                          // from Shoot: sequence, Next, Next → both on Done
  export function finishedPair(browser: Browser, template?: TemplateKey): Promise<{ a: Page; b: Page; url: string }>
  export interface Captured { round: number; at: number; wallAt: number; mirrored: boolean }
  export function lastCapture(page: Page): Promise<Captured | null>
  ```

- [ ] **Step 1: Rewrite `e2e/helpers.ts`**

Replace the whole file with:
```ts
import { expect, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test'

export const BASE = 'http://localhost:5199'

let players = 0
const contexts: BrowserContext[] = []

/** Playwright does not close contexts made with browser.newContext(); each live one keeps a fake camera and WebRTC running, so an unclosed suite slows to a crawl. Call from test.afterEach. */
export async function closePlayers(): Promise<void> {
  await Promise.all(contexts.splice(0).map((c) => c.close().catch(() => undefined)))
}

/**
 * One isolated browser context = one person (own storage, own participant id) with their own IP.
 * The dev server has no Cloudflare edge to set CF-Connecting-IP, so without this every person would
 * share one rate-limit bucket ("local") and a long e2e run would exhaust it. In production the edge
 * overwrites this header, so it cannot be used to dodge the limiter there.
 */
export async function newPlayer(
  browser: Browser,
  opts: { viewport?: { width: number; height: number }; reducedMotion?: 'reduce' | 'no-preference' } = {},
): Promise<Page> {
  players += 1
  const ip = `10.0.${Math.floor(players / 250)}.${(players % 250) + 1}`
  const context = await browser.newContext({
    baseURL: BASE,
    permissions: ['camera', 'clipboard-read', 'clipboard-write'],
    extraHTTPHeaders: { 'CF-Connecting-IP': ip },
    ...opts,
  })
  contexts.push(context)
  return context.newPage()
}

/** Makes a booth and lands on its room-code screen. Returns the booth URL. */
export async function createBooth(page: Page): Promise<string> {
  await page.goto('/create')
  await page.waitForURL(/\/b\/[A-HJ-KM-NP-Z2-9]{6}$/)
  return page.url()
}

export const codeOf = (url: string): string => url.split('/b/')[1] ?? ''

/** The page's one <h1>: every wizard screen names itself with it. */
export const heading = (page: Page, title: string | RegExp): Locator =>
  page.getByRole('heading', { level: 1, name: title, exact: typeof title === 'string' })

/** Every page shows the screen called `title`. */
export async function expectStep(pages: Page[], title: string | RegExp, timeout = 30_000): Promise<void> {
  for (const page of pages) await expect(heading(page, title)).toBeVisible({ timeout })
}

/** Two people in one booth, both on the Frame step. No camera has been asked for yet. */
export async function roomPair(browser: Browser): Promise<{ a: Page; b: Page; url: string }> {
  const a = await newPlayer(browser)
  const b = await newPlayer(browser)
  const url = await createBooth(a)
  await expect(heading(a, 'Send this code to your partner')).toBeVisible()
  await b.goto(url)
  await expectStep([a, b], 'Pick a size')
  return { a, b, url }
}

export const FRAMES = { strip4: 4, grid4: 4, duo2: 2, polaroid: 1 } as const
export type TemplateKey = keyof typeof FRAMES
const TEMPLATE_NAME: Record<TemplateKey, RegExp> = { strip4: /4 cut/i, grid4: /2 × 2/, duo2: /2 cut/i, polaroid: /polaroid/i }

/** Pick a size from the cards. Either person can; the other's screen follows. */
export async function chooseTemplate(page: Page, template: TemplateKey): Promise<void> {
  // `.click()`, not `.check()`: the radio is controlled by the server's plan, so it only flips once the room-state returns.
  await page.getByRole('radio', { name: TEMPLATE_NAME[template] }).click()
}

export const nextStep = (page: Page): Promise<void> => page.getByRole('button', { name: 'Next', exact: true }).click()
export const backStep = (page: Page): Promise<void> => page.getByRole('button', { name: 'Back', exact: true }).click()
export const allowCamera = (page: Page): Promise<void> => page.getByRole('button', { name: 'Allow camera' }).click()

/** Frame → Shoot: `a` picks the size, `b` sees it checked, `a` taps Next, both land on the camera prompt. */
export async function toShoot(a: Page, b: Page, template: TemplateKey = 'duo2'): Promise<void> {
  await chooseTemplate(a, template)
  await expect(b.getByRole('radio', { name: TEMPLATE_NAME[template] })).toBeChecked()
  await nextStep(a)
  await expectStep([a, b], 'Allow your camera')
}

export async function expectRemoteVideo(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const v = document.querySelector<HTMLVideoElement>('[data-testid="remote-video"]')
          return !!v && v.videoWidth > 0 && v.currentTime > 0
        }),
      { message: 'remote video should be decoding frames' },
    )
    .toBe(true)
}

/** Both allow the camera; each sees the other's live video. */
export async function bothCamerasOn(a: Page, b: Page): Promise<void> {
  await allowCamera(a)
  await allowCamera(b)
  await expectRemoteVideo(a)
  await expectRemoteVideo(b)
}

/** Both at the Shoot step with cameras on and video flowing. */
export async function shootPair(browser: Browser, template: TemplateKey = 'duo2'): Promise<{ a: Page; b: Page; url: string }> {
  const pair = await roomPair(browser)
  await toShoot(pair.a, pair.b, template)
  await bothCamerasOn(pair.a, pair.b)
  return pair
}

export async function pressReady(page: Page): Promise<void> {
  await page.getByRole('button', { name: /i'm ready/i }).click() // waits for the button to be enabled
}

/** Both press "I'm ready" once. The shots follow by themselves; both screens end on Pick. */
export async function shootSequence(a: Page, b: Page): Promise<void> {
  await pressReady(a)
  await pressReady(b)
  await expectStep([a, b], 'Pick your favorites', 90_000)
}

/** From the Shoot step to the finished strip: the sequence, then Next (to Style) and Next (to Done). */
export async function finishSession(a: Page, b: Page): Promise<void> {
  await shootSequence(a, b)
  await nextStep(a)
  await expectStep([a, b], 'Pick a look')
  await nextStep(a)
  await expectStep([a, b], 'All done!')
}

export async function finishedPair(browser: Browser, template: TemplateKey = 'duo2'): Promise<{ a: Page; b: Page; url: string }> {
  const pair = await shootPair(browser, template)
  await finishSession(pair.a, pair.b)
  return pair
}

export interface Captured {
  round: number
  at: number
  wallAt: number
  mirrored: boolean
}

export function lastCapture(page: Page): Promise<Captured | null> {
  return page.evaluate(
    () => (window as unknown as { __booth?: { lastCapture?: Captured } }).__booth?.lastCapture ?? null,
  )
}
```

- [ ] **Step 2: Write the wizard spec**

Create `e2e/wizard.spec.ts`:
```ts
import { expect, test, type Page } from '@playwright/test'
import {
  backStep,
  bothCamerasOn,
  chooseTemplate,
  closePlayers,
  codeOf,
  createBooth,
  expectStep,
  heading,
  newPlayer,
  nextStep,
  pressReady,
  roomPair,
  toShoot,
} from './helpers'

test.afterEach(closePlayers)

/** Count getUserMedia calls in the page: the camera must not be asked for before the Shoot step. */
async function countCameraRequests(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __gum: number }
    w.__gum = 0
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
    navigator.mediaDevices.getUserMedia = (constraints) => {
      w.__gum += 1
      return original(constraints)
    }
  })
}
const cameraRequests = (page: Page): Promise<number> => page.evaluate(() => (window as unknown as { __gum: number }).__gum)

// The success criterion of the design (spec §1): share a code, tap a size, Next, allow the camera, ready once,
// Next, Next, Download — and no screen asks two things. Review Focus 1: no camera before Shoot.
test('from the landing page to a downloaded strip, one decision per screen', async ({ browser }) => {
  test.setTimeout(240_000)
  const a = await newPlayer(browser)
  const b = await newPlayer(browser)
  await countCameraRequests(a)
  await countCameraRequests(b)

  // Landing → Room: the code first, no camera.
  await a.goto('/')
  await a.getByRole('link', { name: /start a room/i }).first().click()
  await expect(heading(a, 'Send this code to your partner')).toBeVisible()
  const code = codeOf(a.url())
  await expect(a.getByText(`Room code ${code.split('').join(' ')}`)).toBeAttached()
  await expect(a.getByText('Waiting for your partner…')).toBeVisible()
  expect(await cameraRequests(a)).toBe(0)

  // B joins from the landing page with the code.
  await b.goto('/')
  await b.getByLabel('ENTER CODE').fill(code)
  await b.getByRole('button', { name: 'JOIN', exact: true }).click()
  await expect(a.getByText('Your partner is here!')).toBeVisible()
  await expectStep([a, b], 'Pick a size')

  // Frame: Next waits for a size; either person can choose, the other's screen follows.
  await expect(a.getByRole('button', { name: 'Next', exact: true })).toBeDisabled()
  await chooseTemplate(b, 'duo2')
  await expect(a.getByRole('radio', { name: /2 cut/i })).toBeChecked()
  expect(await cameraRequests(a)).toBe(0)
  expect(await cameraRequests(b)).toBe(0)
  await nextStep(a)

  // Shoot: the prompt screen itself does not ask; the button does.
  await expectStep([a, b], 'Allow your camera')
  await expect(a.getByText('Your camera stays in your browser. Photos are made on your device.')).toBeVisible()
  expect(await cameraRequests(a)).toBe(0)
  await bothCamerasOn(a, b)
  expect(await cameraRequests(a)).toBe(1)
  expect(await cameraRequests(b)).toBe(1)

  // One ready each, then the shots follow by themselves.
  await expectStep([a, b], 'Ready to shoot?')
  await pressReady(a)
  await pressReady(b)
  await expect(a.getByText(/Shot 1 of 4/)).toBeVisible({ timeout: 20_000 })
  await expectStep([a, b], 'Pick your favorites', 90_000)

  // Pick (frames are pre-filled), Style, Done: either person can move on.
  await expect(b.getByRole('button', { name: 'Next', exact: true })).toBeEnabled()
  await nextStep(b)
  await expectStep([a, b], 'Pick a look')
  await nextStep(a)
  await expectStep([a, b], 'All done!')

  const [download] = await Promise.all([a.waitForEvent('download'), a.getByRole('button', { name: 'Download' }).click()])
  expect(download.suggestedFilename()).toBe(`two-up-${code}-duo2.png`)
})

// Review Focus 4: Next and Back are unilateral and cannot skip a step.
test('Next, Back and the stepper move both screens', async ({ browser }) => {
  const { a, b } = await roomPair(browser)
  await expect(a.locator('[aria-current="step"]')).toContainText('Frame')

  await chooseTemplate(a, 'polaroid')
  await nextStep(b) // the other person can move on
  await expectStep([a, b], 'Allow your camera')
  await expect(b.locator('[aria-current="step"]')).toContainText('Shoot')

  await backStep(b)
  await expectStep([a, b], 'Pick a size')
  await expect(a.getByRole('radio', { name: /polaroid/i })).toBeChecked() // the size is kept

  await nextStep(a)
  await expectStep([a, b], 'Allow your camera')
  await a.getByRole('button', { name: /^Frame/ }).click() // a finished step in the stepper goes back
  await expectStep([a, b], 'Pick a size')
  await expect(a.getByRole('button', { name: /^Shoot/ })).toHaveCount(0) // a step ahead is not a button
})

// Review Focus 4: nobody is moved while shots are being taken.
test('while the shots run, Back and the stepper are gone and Next cannot be pressed', async ({ browser }) => {
  test.setTimeout(120_000)
  const { a, b } = await roomPair(browser)
  await toShoot(a, b, 'polaroid')
  await bothCamerasOn(a, b)
  await pressReady(a)
  await pressReady(b)
  await expect(a.getByText(/Shot 1 of 3/)).toBeVisible({ timeout: 20_000 })
  await expect(a.getByRole('button', { name: 'Back', exact: true })).toHaveCount(0)
  await expect(a.getByRole('button', { name: /^Frame/ })).toHaveCount(0)
  await expect(b.getByRole('button', { name: 'Shooting…' })).toBeDisabled()
  await expectStep([a, b], 'Pick your favorites', 90_000)
})

// Review Focus 1: the room, Frame, Next and Back never need a camera. (A blocked camera is not a dead end either — that is
// errors.spec.ts, Task 11.) Here getUserMedia always rejects; if any screen before Shoot called it, the camera problem
// screen would appear.
test('the room, Frame, Next and Back work with no camera at all', async ({ browser }) => {
  const a = await newPlayer(browser)
  const b = await newPlayer(browser)
  for (const page of [a, b]) {
    await page.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('must not be called', 'NotAllowedError'))
    })
  }
  const url = await createBooth(a)
  await b.goto(url)
  await expectStep([a, b], 'Pick a size')
  await chooseTemplate(a, 'strip4')
  await nextStep(a)
  await expectStep([a, b], 'Allow your camera')
  await backStep(a)
  await expectStep([a, b], 'Pick a size')
  await expect(a.getByText('CAMERA BLOCKED')).toHaveCount(0)
  await expect(a.getByRole('button', { name: 'Allow camera' })).toHaveCount(0) // that button belongs to the Shoot step
})
```

- [ ] **Step 3: Run it and watch it fail for the right reason**

Run: `npx playwright test e2e/wizard.spec.ts`
Expected: FAIL in every test, at the first wizard-specific step — e.g. `getByRole('link', { name: /start a room/i })` not found (the landing page still says "CREATE A BOOTH") or the heading `Send this code to your partner` never appears. A failure inside a *helper* that comes from a typo (not from missing UI) is a bug in the helper: fix it and re-run until the failures are all "the new UI is not there".

- [ ] **Step 4: Commit (red on purpose)**

```bash
git add e2e/helpers.ts e2e/wizard.spec.ts
git commit -m "test: add the wizard end-to-end spec and helpers"
```
Say in the commit body that the spec fails until the cutover in the next commit.

---

## Task 10: Cut the booth page over to the wizard

**Files:**
- Modify (rewrite): `src/client/pages/Booth.tsx`
- Modify: `src/client/hooks/useCamera.ts`, `src/client/screens/Splash.tsx`, `src/client/pages/Home.tsx`, `src/client/components/SiteHeader.tsx`
- Delete: `src/client/screens/CameraGate.tsx`, `Lobby.tsx`, `Stage.tsx`, `FormatPanel.tsx`, `PickPanel.tsx`, `ReadyCard.tsx`, `Result.tsx`; `src/client/components/CameraFrame.tsx`, `Steps.tsx`, `RoomCode.tsx`

**Interfaces:**
- Consumes: every screen and hook from Phase 2 (`ShellInfo`, `RoomScreen`, `FrameScreen`, `ShootScreen`, `PickScreen`, `StyleScreen`, `DoneScreen`, `LostPhotosScreen`, `useStyleState`, `useFinishedStrip`); from Phase 1: `Plan`, `Step`, `PlanAction`, `PState.camera`, the `camera` client message, `missingShots`, `finishedOf`, `needsCompleteResend`.
- Produces: the wizard at `/b/:code`; `useCamera()` gains `stop: () => void`.

**Design notes for the implementer (read before writing `Booth.tsx`)** — decisions the spec leaves to the page:
1. **The socket no longer waits for the camera** (`enabled: gate === 'ok'`). The camera is started only by the "Allow camera" button on the Shoot screen.
2. **Camera flag.** An effect sends `{type:'camera', on: stream !== null}` whenever the socket is `open` or the stream appears/disappears. The room forgets the flag when a socket drops, so the effect also re-announces after every reconnect (it re-runs when `room.status` returns to `open`).
3. **The call is built from flags, not from join events.** When `me.camera && partner.camera && partner.connected`, slot `a` calls `buildAndOffer()` and slot `b` builds on the offer (as before); when that stops being true the peer is closed.
4. **The camera is stopped on Style and Done** (nothing needs it; no recording light while looking at your strip). Going back to Shoot shows the "Allow your camera" screen again.
5. **The finished strip is protected only against a reset** (the partner's "Make another" or "Start over"): `snapshot && !live && plan.shots.length === 0` shows the old strip with a notice. A plain Back by the partner is normal navigation (our photos are still held), not a reason to freeze.
6. **Solo Style → Done.** If the partner left while we are on Style, the room refuses `go`; the page then shows Done locally (`localStep`) so Download stays reachable. The local override clears when the partner returns or the plan moves.
7. **Failure screens never hide a finished strip:** while the plan is on Style/Done and we hold the photos (`finishedView`), the camera/closed-socket/lost-photos/room/call-failed screens are skipped.
8. **"Photos lost"** is `!plan.running && plan.step !== 'frame' && missingShots(plan, store).length > 0`. `running` is excluded so a shot the partner just recorded (ours is a few ms behind) never flashes it.

- [ ] **Step 1: `useCamera.stop`, a sentence-case `Splash`**

In `src/client/hooks/useCamera.ts`, add after `flip`:
```ts
  /** Release the camera (the recording light goes off). Used once nothing needs it. */
  const stop = useCallback(() => {
    stopCurrent()
    streamRef.current = null
    setStream(null)
  }, [stopCurrent])
```
and change the return to
```ts
  return { stream, error, mirrored: track ? isMirrored(track) : true, canFlip, start, flip, stop }
```
In `src/client/screens/Splash.tsx` remove `uppercase` from the `<p>` class.

- [ ] **Step 2: Rewrite `Booth.tsx`**

Replace the whole file with:
```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router'
import { SYNC_BURST_READY } from '../../shared/constants'
import { defaultPlan, type PlanAction, type Step } from '../../shared/plan'
import { otherSlot, type ServerMessage, type SlotName } from '../../shared/protocol'
import { normalizeRoomInput } from '../../shared/room-code'
import { useToast } from '../components/BrutalToast'
import type { ConnKind } from '../components/ConnectionStatus'
import type { ShellInfo } from '../components/WizardShell'
import { useCamera } from '../hooks/useCamera'
import { useFinishedStrip } from '../hooks/useFinishedStrip'
import { useLatest } from '../hooks/useLatest'
import { useRoom } from '../hooks/useRoom'
import { useRoomGate } from '../hooks/useRoomGate'
import { useStyleState } from '../hooks/useStyleState'
import { useSyncClock } from '../hooks/useSyncClock'
import { useWebRTC } from '../hooks/useWebRTC'
import type { CameraError } from '../lib/camera'
import { browserCaptureDeps, createCaptureScheduler } from '../lib/capture'
import { recordCapture } from '../lib/dev-hook'
import { captureFrame, FrameNotReadyError } from '../lib/photo'
import { parseControl, PhotoReceiver, sendPhoto } from '../lib/photo-transfer'
import { getParticipantId } from '../lib/session'
import {
  completeRound,
  finishedOf,
  highestReferenced,
  mergePhoto,
  missingShots,
  needsCompleteResend,
  pruneStore,
  putRound,
  type Finished,
  type Pending,
  type TakeStore,
} from '../lib/takes'
import { DoneScreen } from '../screens/DoneScreen'
import { FrameScreen } from '../screens/FrameScreen'
import { LostPhotosScreen } from '../screens/LostPhotosScreen'
import { PickScreen } from '../screens/PickScreen'
import { Problem, type ProblemKind } from '../screens/Problem'
import { RoomScreen } from '../screens/RoomScreen'
import { ShootScreen } from '../screens/ShootScreen'
import { Splash } from '../screens/Splash'
import { StyleScreen } from '../screens/StyleScreen'

const cameraProblem: Record<CameraError, ProblemKind> = {
  blocked: 'camera-blocked',
  unavailable: 'camera-unavailable',
  unsupported: 'camera-unsupported',
}

/** Stable reference for "no room-state yet", so effects keyed on the plan do not fire every render. */
const NO_PLAN = defaultPlan()

function closedProblem(code: number | null): ProblemKind {
  switch (code) {
    case 4403:
      return 'room-full'
    case 4404:
      return 'not-found'
    case 4000:
      return 'expired'
    case 4001:
      return 'replaced'
    default:
      return 'connection-lost'
  }
}

export function Booth() {
  const { code: raw } = useParams()
  const code = normalizeRoomInput(raw ?? '')
  return code ? <BoothInner code={code} /> : <Problem kind="not-found" />
}

function BoothInner({ code }: { code: string }) {
  const participantId = useMemo(() => getParticipantId(code), [code])
  const gate = useRoomGate(code, participantId)
  const camera = useCamera()
  const style = useStyleState()
  const toast = useToast()
  const localVideo = useRef<HTMLVideoElement | null>(null)
  const slot = useRef<SlotName | null>(null)
  const [countdown, setCountdown] = useState<{ round: number; captureAt: number } | null>(null)
  const [missed, setMissed] = useState(false)
  const [store, setStore] = useState<TakeStore>(new Map())
  const highestSeen = useRef(-1) // the newest round any plan has mentioned: anything newer is a photo pair still waiting to be recorded
  const [partnerMirrored, setPartnerMirrored] = useState(true) // until the partner's `cam` message says otherwise
  const [captured, setCaptured] = useState(false)
  const [exchangeFailed, setExchangeFailed] = useState(false) // the data channel itself failed to deliver our photo
  const pending = useRef<Pending | null>(null)
  const completed = useRef(-1) // highest round already finished: later duplicates are ignored
  const currentRound = useRef(0) // the round the server most recently announced
  const [snapshot, setSnapshot] = useState<Finished | null>(null)
  const [localStep, setLocalStep] = useState<Step | null>(null)

  // Server events → WebRTC and the capture scheduler. `latest` keeps this closure fresh without reconnecting the socket.
  const onMessage = useLatest((m: ServerMessage) => {
    switch (m.type) {
      case 'room-state':
        slot.current = m.state.you
        // A reload or reconnect mid-round: the room-state carries the round, and the scheduler dedupes repeats.
        if (m.state.phase === 'capture' && m.state.captureAt !== null) beginRound.current(m.state.round, m.state.captureAt)
        // Our photo-complete may have been lost while the socket was reconnecting; the server is idempotent, so say it again.
        if (needsCompleteResend(m.state, completed.current)) room.send({ type: 'photo-complete', round: m.state.round })
        return
      case 'partner-left':
        scheduler.cancel()
        setCountdown(null)
        rtc.closePeer()
        return
      case 'offer':
      case 'answer':
      case 'ice-candidate':
        rtc.onSignal(m)
        return
      case 'pong':
        sync.onPong(m)
        return
      case 'capture-scheduled':
        beginRound.current(m.round, m.captureAt)
        return
      default:
        return
    }
  })

  const room = useRoom({ code, participantId, enabled: gate === 'ok', onMessage: (m) => onMessage.current(m) })

  const plan = room.state?.plan ?? NO_PLAN
  const sendToRoom = room.send
  const sendPlan = useCallback((action: PlanAction) => void sendToRoom({ type: 'plan', action }), [sendToRoom])

  // Keep only the photos the plan still lists; the store is the one place photos live.
  useEffect(() => {
    highestSeen.current = Math.max(highestSeen.current, highestReferenced(plan))
    setStore((s) => pruneStore(s, plan, highestSeen.current))
  }, [plan])

  // The finished strip is the one thing that cannot be recreated. Remember the newest one, so it stays on screen if the
  // partner starts over while you are still looking at it (spec §5).
  const live = useMemo(() => finishedOf(plan, store), [plan, store])
  useEffect(() => {
    if (live) setSnapshot(live)
  }, [live])
  const strip = useFinishedStrip(live ?? snapshot, code, style)

  // A photo from either side lands here; when both halves of a round exist it is stored and reported.
  const addPhoto = useLatest((round: number, who: 'own' | 'partner', blob: Blob) => {
    if (round <= completed.current) return
    const merged = mergePhoto(pending.current, round, who, blob)
    pending.current = merged
    const done = slot.current ? completeRound(merged, slot.current) : null
    if (!done) return
    completed.current = round
    pending.current = null
    setStore((all) => putRound(all, done))
    room.send({ type: 'photo-complete', round })
  })
  const receiver = useMemo(
    () => new PhotoReceiver(() => currentRound.current, (round, blob) => addPhoto.current(round, 'partner', blob)),
    [addPhoto],
  )

  const rtc = useWebRTC({
    code,
    participantId,
    send: room.send,
    localStream: camera.stream,
    onChannelText: (text) => {
      const control = parseControl(text)
      if (!control) return
      if (control.t === 'cam') setPartnerMirrored(control.mirrored)
      else receiver.onControl(control)
    },
    onChannelBinary: (data) => receiver.onBinary(data),
  })
  const sync = useSyncClock(room.send, room.status === 'open')
  const scheduler = useMemo(() => createCaptureScheduler(browserCaptureDeps(sync.now)), [sync.now])

  const onCapture = useLatest((round: number, at: number) => {
    const wallAt = Date.now() // the moment the shared timestamp fired on this device
    const video = localVideo.current
    const mirrored = camera.mirrored
    void (async () => {
      try {
        if (!video) throw new FrameNotReadyError()
        const blob = await captureFrame(video, { mirrored })
        recordCapture({ round, at, wallAt, mirrored })
        setCaptured(true)
        addPhoto.current(round, 'own', blob)
        const channel = { sendText: rtc.sendText, sendBinary: rtc.sendBinary, waitForDrain: rtc.waitForDrain }
        if (!(await sendPhoto(channel, round, blob))) setExchangeFailed(true)
      } catch {
        setMissed(true) // no frame yet, or the encoder failed: say so rather than sending nothing silently
      }
    })()
  })
  const beginRound = useLatest((round: number, captureAt: number) => {
    // The server repeats the current round in every room-state while it is in flight. A repeat must change
    // nothing — in particular it must not clear a "missed" that the first delivery just raised.
    if (round <= currentRound.current) return
    currentRound.current = round
    pending.current = null
    setMissed(false)
    setCaptured(false)
    setExchangeFailed(false)
    // May report "missed" synchronously when the message itself arrived far too late.
    const accepted = scheduler.schedule(round, captureAt, (r, at) => onCapture.current(r, at), () => setMissed(true))
    if (accepted) setCountdown({ round, captureAt })
  })
  const finishCountdown = useCallback(() => setCountdown(null), [])

  const mySlot = room.state?.you
  const me = room.state && mySlot ? room.state.participants[mySlot] : null
  const partner = room.state && mySlot ? room.state.participants[otherSlot(mySlot)] : null
  const partnerHere = Boolean(partner?.connected)
  const cameraOn = camera.stream !== null
  const bothCameras = Boolean(me?.camera && partner?.camera && partnerHere)

  // Tell the room whether this device has a camera on. The room forgets it when a socket drops, so this runs again after
  // every reconnect (the status returns to `open`).
  const roomStatus = room.status
  useEffect(() => {
    if (roomStatus === 'open') sendToRoom({ type: 'camera', on: cameraOn })
  }, [roomStatus, cameraOn, sendToRoom])

  // The call exists only while both cameras are on: slot a offers, slot b builds on the offer.
  const { buildAndOffer, closePeer } = rtc
  useEffect(() => {
    if (!bothCameras) {
      closePeer()
      return
    }
    if (slot.current === 'a') buildAndOffer()
  }, [bothCameras, buildAndOffer, closePeer])

  // Nothing after the Shoot step needs the camera: let the recording light go off once the strip is being styled.
  const { stop: stopCamera } = camera
  useEffect(() => {
    if (plan.step === 'style' || plan.step === 'done') stopCamera()
  }, [plan.step, stopCamera])

  // Tell the partner whether our preview (and so our photo) is mirrored, so their frame matches our photo.
  const { sendText, channelOpen } = rtc
  useEffect(() => {
    if (channelOpen) sendText(JSON.stringify({ t: 'cam', mirrored: camera.mirrored }))
  }, [channelOpen, sendText, camera.mirrored])

  // Say so when the partner arrives; remember that someone was here, so the room screen can say they left.
  const [hadPartner, setHadPartner] = useState(false)
  const wasHere = useRef(false)
  useEffect(() => {
    if (partnerHere) {
      setHadPartner(true)
      if (!wasHere.current) toast('Your partner is here!')
    }
    wasHere.current = partnerHere
  }, [partnerHere, toast])

  // A solo view of Done (the partner left while we were on Style) follows the shared plan again once they are back or the plan moves.
  useEffect(() => {
    setLocalStep(null)
  }, [plan.step, partnerHere])

  // Photos live only in this tab, so warn before a reload or close throws them away.
  const hasPhotos = store.size > 0 || snapshot !== null
  useEffect(() => {
    if (!hasPhotos) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [hasPhotos])

  if (gate === 'checking') return <Splash text="Checking booth…" />
  if (gate === 'not-found') return <Problem kind="not-found" />
  if (gate === 'full') return <Problem kind="room-full" />
  if (gate === 'error') return <Problem kind="gate-error" onRetry={() => location.reload()} />

  const step: Step = localStep === 'done' && plan.step === 'style' ? 'done' : plan.step
  const canEdit = room.status === 'open' && room.state?.phase === 'ready'
  const status: ConnKind =
    room.status === 'reconnecting'
      ? 'reconnecting'
      : room.status !== 'open'
        ? 'lost'
        : !partnerHere
          ? 'waiting'
          : !bothCameras
            ? 'connected'
            : rtc.peerState === 'failed'
              ? 'lost'
              : rtc.peerState === 'connected'
                ? 'connected'
                : rtc.peerState === 'reconnecting'
                  ? 'reconnecting'
                  : 'connecting'

  const goStep = (to: Step) => {
    if (!partnerHere && plan.step === 'style' && to === 'done') {
      setLocalStep('done') // the room cannot move the plan with one person in it, but the strip must stay reachable
      return
    }
    sendPlan({ k: 'go', to })
  }
  const makeAnother = () => {
    setSnapshot(null)
    sendPlan({ k: 'reset' })
  }
  const onReady = (ready: boolean) => {
    if (ready) sync.burst(SYNC_BURST_READY) // refresh the offset right before a round
    room.send({ type: ready ? 'ready' : 'unready' })
  }
  const shell: ShellInfo = { code, status, hasPhotos, running: plan.running, canEdit, onGo: goStep }

  // The partner started over while we looked at our strip: keep it on screen, say so, and let us decide when to join them.
  if (snapshot && !live && plan.shots.length === 0) {
    return (
      <DoneScreen
        shell={{ ...shell, canEdit: false }}
        strip={strip}
        style={style}
        partnerHere={partnerHere}
        notice={{ text: 'Your partner started a new strip. Download yours first.', action: 'Continue', onAction: () => setSnapshot(null) }}
        onMakeAnother={() => setSnapshot(null)}
      />
    )
  }

  // A finished strip is the one thing that cannot be recreated. While we hold it, no failure screen takes it away.
  const finishedView = live !== null && (step === 'style' || step === 'done')
  if (!finishedView) {
    if (camera.error && plan.step === 'shoot') return <Problem kind={cameraProblem[camera.error]} onRetry={() => void camera.start()} />
    if (room.status === 'closed') return <Problem kind={closedProblem(room.closeCode)} onRetry={room.reconnect} />
    if (!room.state) return <Splash text="Connecting…" />
    const lostPhotos = !plan.running && plan.step !== 'frame' && missingShots(plan, store).length > 0
    if (lostPhotos) return <LostPhotosScreen shell={shell} step={plan.step} onStartOver={makeAnother} />
    if (!partnerHere) return <RoomScreen shell={shell} shareUrl={`${location.origin}/b/${code}`} partnerLeft={hadPartner} />
    if (plan.step === 'shoot' && ((bothCameras && rtc.peerState === 'failed') || exchangeFailed)) {
      return (
        <Problem
          kind="webrtc-failed"
          onRetry={() => {
            setExchangeFailed(false)
            room.reconnect()
          }}
        />
      )
    }
  }

  switch (step) {
    case 'frame':
      return <FrameScreen shell={shell} plan={plan} onPlan={sendPlan} />
    case 'shoot':
      return (
        <ShootScreen
          shell={shell}
          plan={plan}
          stream={camera.stream}
          mirrored={camera.mirrored}
          canFlip={camera.canFlip}
          onAllowCamera={() => void camera.start()}
          onFlip={() => void camera.flip()}
          localVideoRef={localVideo}
          remoteStream={rtc.remoteStream}
          remoteMirrored={partnerMirrored}
          me={me}
          partner={partner}
          linkReady={sync.synced && rtc.peerState === 'connected' && rtc.channelOpen}
          onReady={onReady}
          countdown={countdown}
          now={sync.now}
          onCountdownDone={finishCountdown}
          missed={missed}
          exchanging={room.state?.phase === 'capture' && countdown === null}
          captured={captured}
        />
      )
    case 'pick':
      return <PickScreen shell={shell} plan={plan} store={store} mySlot={mySlot ?? 'a'} onPlan={sendPlan} />
    case 'style':
      return <StyleScreen shell={shell} strip={strip} style={style} />
    case 'done':
      return <DoneScreen shell={shell} strip={strip} style={style} partnerHere={partnerHere} onMakeAnother={makeAnother} />
  }
}
```

- [ ] **Step 3: Landing copy**

`src/client/pages/Home.tsx`: change the two hero buttons' text — `CREATE A BOOTH →` → `Start a room`, `JOIN A BOOTH` (the `<a href="#join">`, not the section heading) → `Join a room`. `src/client/components/SiteHeader.tsx`: the nav link text `Create` → `Start a room`. The landing headline, the how-it-works steps and the privacy note are not edited.

- [ ] **Step 4: Delete the old screens**

```bash
git rm src/client/screens/CameraGate.tsx src/client/screens/Lobby.tsx src/client/screens/Stage.tsx \
  src/client/screens/FormatPanel.tsx src/client/screens/PickPanel.tsx src/client/screens/ReadyCard.tsx src/client/screens/Result.tsx \
  src/client/components/CameraFrame.tsx src/client/components/Steps.tsx src/client/components/RoomCode.tsx
grep -rnE "CameraFrame|components/Steps|RoomCode|screens/(Lobby|Stage|FormatPanel|PickPanel|ReadyCard|Result|CameraGate)" src || echo "no leftover references"
```
Expected: `no leftover references`. If `BrutalLabel` or anything else is now unused by every file, leave it — only delete what is listed.

- [ ] **Step 5: Static checks**

Run, expecting every one to exit 0:
```bash
npx tsc -p tsconfig.client.json --noEmit
npx tsc -p tsconfig.worker.json --noEmit
npm run lint
npm test
npm run build
```
Fix type errors in `Booth.tsx` against the real hook signatures rather than weakening the types. (If `tsc -b` is run it will still complain about the unmigrated `e2e/` specs; that is expected until Task 12.)

- [ ] **Step 6: The wizard spec goes green**

Run: `npx playwright test e2e/wizard.spec.ts`
Expected: all four tests PASS. If one fails, read the failure and the screenshot/trace in `test-results/`; fix the **app** unless the spec contradicts the design spec (then fix the spec and say so in the commit body).

- [ ] **Step 7: Commit in two steps**

```bash
git add src/client/pages/Booth.tsx src/client/hooks/useCamera.ts src/client/screens/Splash.tsx src/client/pages/Home.tsx src/client/components/SiteHeader.tsx
git commit -m "feat: run the booth page as a step-by-step wizard"
git add -u src/client
git commit -m "refactor: remove the old stage, lobby and result screens"
```
(`git add -u` stages the deletions only; check `git status` shows nothing else staged.)

---

## Task 11: Move the connection, room, join, error and accessibility specs to the wizard

**Files:**
- Modify: `e2e/connect.spec.ts`, `e2e/join.spec.ts`, `e2e/errors.spec.ts`, `e2e/a11y.spec.ts`
- Create: `e2e/room.spec.ts`
- Delete: `e2e/lobby.spec.ts`

**Interfaces:** consumes the helpers of Task 9. Produces nothing new. Each spec below replaces the file's content in full.

- [ ] **Step 1: `e2e/connect.spec.ts`**

```ts
import { expect, test } from '@playwright/test'
import { allowCamera, bothCamerasOn, closePlayers, codeOf, expectRemoteVideo, expectStep, newPlayer, roomPair, shootPair, toShoot } from './helpers'

test.afterEach(closePlayers)

test('two people see each other over real WebRTC', async ({ browser }) => {
  const { a, b } = await shootPair(browser)
  await expect(a.getByText('● Connected')).toBeVisible()
  await expect(b.getByText('● Connected')).toBeVisible()
})

test('a third person is told the booth is full before any camera prompt', async ({ browser }) => {
  const { url } = await roomPair(browser)
  const c = await newPlayer(browser)
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
  const { a } = await roomPair(browser)
  await a.reload()
  await expect(a.getByText('BOOTH FULL.')).toHaveCount(0)
  await expectStep([a], 'Pick a size') // the plan is the room's, so a reload lands on the same step
})

// The room forgets a person's camera flag when their socket drops; a reload at Shoot must announce it again.
test('reloading at the Shoot step asks for the camera again, and the call comes back', async ({ browser }) => {
  const { a, b } = await shootPair(browser)
  await a.reload()
  await expectStep([a], 'Allow your camera')
  await allowCamera(a)
  await expectRemoteVideo(a)
  await expectRemoteVideo(b)
})

// Final review I6: the ICE endpoint is gated. A broken gate would be invisible otherwise, because the client quietly
// falls back to public STUN when /api/ice fails — so assert the real browser's own requests are accepted.
test("the browser's own ICE requests pass the membership gate, and a stranger's do not", async ({ browser }) => {
  const { a, b, url } = await roomPair(browser)
  const statuses: number[] = []
  a.on('response', (r) => {
    if (r.url().includes('/api/ice')) statuses.push(r.status())
  })
  await toShoot(a, b)
  await bothCamerasOn(a, b)

  expect(statuses.length).toBeGreaterThan(0)
  expect(statuses.every((s) => s === 200)).toBe(true)

  const stranger = await b.evaluate(async (c) => (await fetch(`/api/ice?room=${c}`)).status, codeOf(url)) // no participant id
  expect(stranger).toBe(403)
})
```

- [ ] **Step 2: `e2e/room.spec.ts` (replaces `lobby.spec.ts`)**

```ts
import { expect, test } from '@playwright/test'
import { closePlayers, codeOf, createBooth, heading, newPlayer, roomPair, toShoot } from './helpers'

test.afterEach(closePlayers)

test('the room screen shows the code, copies the link and shows a QR code', async ({ browser }) => {
  const a = await newPlayer(browser)
  const url = await createBooth(a)
  const code = codeOf(url)

  await expect(heading(a, 'Send this code to your partner')).toBeVisible()
  await expect(a.getByText('They type it in, or open your link.')).toBeVisible()
  await expect(a.getByText(`Room code ${code.split('').join(' ')}`)).toBeAttached() // spoken form for screen readers
  await expect(a.getByText(code.charAt(0), { exact: true }).first()).toBeVisible() // the big tiles
  await expect(a.getByText('Waiting for your partner…')).toBeVisible()

  await a.getByRole('button', { name: 'Copy link' }).click()
  await expect(a.getByText('Link copied')).toBeVisible()
  expect(await a.evaluate(() => navigator.clipboard.readText())).toBe(url)

  await a.getByRole('button', { name: 'QR code' }).click()
  const dialog = a.getByRole('dialog')
  await expect(dialog).toBeVisible()
  const qr = dialog.getByRole('img', { name: 'QR code for this booth' })
  await expect(qr).toBeVisible()
  expect(await qr.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(100)
  await a.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
})

test('the camera prompt carries one friendly privacy sentence', async ({ browser }) => {
  const { a, b } = await roomPair(browser)
  await toShoot(a, b)
  await expect(a.getByText('Your camera stays in your browser. Photos are made on your device.')).toBeVisible()
})

test("the landing page keeps the brief's privacy note", async ({ browser }) => {
  const a = await newPlayer(browser)
  await a.goto('/')
  await expect(a.getByText(/YOUR CAMERA STAYS IN YOUR BROWSER/)).toBeVisible()
  await expect(a.getByText(/PHOTOS ARE PROCESSED\s+LOCALLY UNLESS YOU CHOOSE TO SAVE OR SHARE THEM/)).toBeVisible()
})
```
Run `git rm e2e/lobby.spec.ts`.

- [ ] **Step 3: `e2e/join.spec.ts`**

The join form, its labels and its brief error copy did not change. What did change: a person who joins now connects to the room at once (there is no camera step in front of the socket any more), so a booth is **full after its second joiner**. The old test joined three people into one booth; give each way of joining its own booth. Replace the file with:
```ts
import { expect, test } from '@playwright/test'
import { closePlayers, codeOf, createBooth, newPlayer } from './helpers'

test.afterEach(closePlayers)

/** A booth that has its host in it, and the joiner's page on the landing page. */
async function boothAndJoiner(browser: Parameters<typeof newPlayer>[0]) {
  const host = await newPlayer(browser)
  const url = await createBooth(host)
  const joiner = await newPlayer(browser)
  return { url, code: codeOf(url), joiner }
}

test('joining accepts a sloppy code', async ({ browser }) => {
  const { code, joiner } = await boothAndJoiner(browser)
  expect(code).toHaveLength(6)
  await joiner.goto('/')
  await joiner.getByLabel('ENTER CODE').fill(`  ${code.slice(0, 3).toLowerCase()}-${code.slice(3).toLowerCase()} `)
  await joiner.getByRole('button', { name: 'JOIN', exact: true }).click()
  await expect(joiner).toHaveURL(new RegExp(`/b/${code}$`))
})

test('joining accepts a pasted URL', async ({ browser }) => {
  const { url, code, joiner } = await boothAndJoiner(browser)
  await joiner.goto('/join')
  await joiner.getByLabel('ENTER CODE').fill(url)
  await joiner.getByRole('button', { name: 'JOIN', exact: true }).click()
  await expect(joiner).toHaveURL(new RegExp(`/b/${code}$`))
})

test('joining refuses look-alike letters and codes that do not exist', async ({ browser }) => {
  const wrong = await newPlayer(browser)
  await wrong.goto('/join')
  await wrong.getByLabel('ENTER CODE').fill('O0I1LL')
  await wrong.getByRole('button', { name: 'JOIN', exact: true }).click()
  await expect(wrong.getByText('THAT CODE LOOKS WRONG.')).toBeVisible()

  await wrong.getByLabel('ENTER CODE').fill('ZZZZZZ')
  await wrong.getByRole('button', { name: 'JOIN', exact: true }).click()
  await expect(wrong.getByText('NO BOOTH WITH THAT CODE.')).toBeVisible()
})

test('a full booth turns a third person away at the join form', async ({ browser }) => {
  const { url, code, joiner } = await boothAndJoiner(browser)
  await joiner.goto(url) // the second person takes the last place
  await expect(joiner.getByText('Pick a size')).toBeVisible()

  const third = await newPlayer(browser)
  await third.goto('/join')
  await third.getByLabel('ENTER CODE').fill(code)
  await third.getByRole('button', { name: 'JOIN', exact: true }).click()
  await expect(third.getByText('BOOTH FULL.')).toBeVisible()
})
```
Run it.

- [ ] **Step 4: `e2e/errors.spec.ts`**

```ts
import { expect, test, type Page } from '@playwright/test'
import { allowCamera, closePlayers, createBooth, expectRemoteVideo, expectStep, newPlayer, roomPair, shootPair, toShoot } from './helpers'

test.afterEach(closePlayers)

/**
 * The error name must travel as an argument: addInitScript serializes only the function, so a closed-over variable would
 * not exist in the page. `__allowCamera()` puts the real getUserMedia back, to prove "Try again" works.
 */
async function denyCamera(page: Page, errorName: string): Promise<void> {
  await page.addInitScript((name) => {
    const md = navigator.mediaDevices
    const real = md.getUserMedia.bind(md)
    ;(window as unknown as { __allowCamera: () => void }).__allowCamera = () => {
      md.getUserMedia = real
    }
    md.getUserMedia = () => Promise.reject(new DOMException('nope', name))
  }, errorName)
}

// Review Focus 1: a blocked camera is not a dead end.
test('camera blocked shows the brief copy, and "Try again" works once it is allowed', async ({ browser }) => {
  const { a, b } = await roomPair(browser)
  await denyCamera(a, 'NotAllowedError')
  await a.reload()
  await expectStep([a], 'Pick a size')
  await toShoot(a, b)
  await allowCamera(a)
  await expect(a.getByText('CAMERA BLOCKED')).toBeVisible()
  await expect(a.getByText('WE NEED CAMERA ACCESS TO USE THE BOOTH.')).toBeVisible()

  await a.evaluate(() => (window as unknown as { __allowCamera: () => void }).__allowCamera())
  await a.getByRole('button', { name: 'TRY AGAIN' }).click()
  await expectStep([a], 'Ready to shoot?')
  await expect(a.getByTestId('local-video')).toBeVisible()
})

test('no camera, and no camera API, each get their own message', async ({ browser }) => {
  const first = await roomPair(browser)
  await denyCamera(first.a, 'NotFoundError')
  await first.a.reload()
  await toShoot(first.a, first.b)
  await allowCamera(first.a)
  await expect(first.a.getByText('NO CAMERA FOUND')).toBeVisible()

  const second = await roomPair(browser)
  await second.a.addInitScript(() => Object.defineProperty(navigator, 'mediaDevices', { value: undefined }))
  await second.a.reload()
  await toShoot(second.a, second.b)
  await allowCamera(second.a)
  await expect(second.a.getByText('CAMERA NEEDS HTTPS')).toBeVisible()
})

test('when the partner leaves you are told, and their slot stays reserved against strangers', async ({ browser }) => {
  const { a, b, url } = await roomPair(browser)
  await b.close()
  await expect(a.getByText('They left :(')).toBeVisible()
  await expect(a.getByText('Waiting for them to come back.')).toBeVisible()
  await expect(a.getByText('Waiting for your partner…')).toBeVisible()
  const stranger = await newPlayer(browser)
  await stranger.goto(url) // a brand-new person: the leaver's slot is reserved for them for the grace period
  await expect(stranger.getByText('BOOTH FULL.')).toBeVisible()
})

test('the leaver can come back (same tab storage) and both see video again', async ({ browser }) => {
  const { a, b } = await shootPair(browser)
  await b.reload()
  await expectStep([b], 'Allow your camera')
  await allowCamera(b)
  await expectRemoteVideo(a)
  await expectRemoteVideo(b)
})

test('opening the same booth as the same person in a second tab replaces the first', async ({ browser }) => {
  const first = await newPlayer(browser)
  const url = await createBooth(first)
  const code = url.split('/b/')[1] ?? ''
  const id = await first.evaluate((c) => sessionStorage.getItem(`booth:pid:${c}`), code)
  expect(id).toBeTruthy()

  const second = await newPlayer(browser)
  await second.addInitScript(([c, v]) => sessionStorage.setItem(`booth:pid:${c}`, v as string), [code, id])
  await second.goto(url)

  await expect(first.getByText('OPENED ELSEWHERE.')).toBeVisible()
  await expect(second.getByText('Waiting for your partner…')).toBeVisible()
})
```

- [ ] **Step 5: `e2e/a11y.spec.ts`**

Keep `expectNoViolations`, the keyboard-focus test and the first test (landing, join, not found) exactly as they are, changing only the import line to
```ts
import { bothCamerasOn, chooseTemplate, closePlayers, createBooth, expectStep, newPlayer, nextStep, shootSequence, toShoot } from './helpers'
```
Replace the other three tests (the "camera gate, lobby, stage…" test, the reduced-motion test and the mobile test) with:
```ts
test('every wizard step has no WCAG A/AA violations', async ({ browser }) => {
  test.setTimeout(240_000)
  const a = await newPlayer(browser)
  const b = await newPlayer(browser)
  const url = await createBooth(a)
  await expectNoViolations(a, 'room')

  await b.goto(url)
  await expectStep([a, b], 'Pick a size')
  await expectNoViolations(a, 'frame')
  await chooseTemplate(a, 'polaroid')
  await expect(b.getByRole('radio', { name: /polaroid/i })).toBeChecked()
  await expectNoViolations(a, 'frame with a size')

  await nextStep(a)
  await expectStep([a, b], 'Allow your camera')
  await expectNoViolations(a, 'shoot: camera prompt')
  await bothCamerasOn(a, b)
  await expectStep([a], 'Ready to shoot?')
  await expectNoViolations(a, 'shoot: live frames')

  await shootSequence(a, b)
  await expectNoViolations(a, 'pick')
  await nextStep(a)
  await expectStep([a, b], 'Pick a look')
  await expectNoViolations(a, 'style')
  await nextStep(a)
  await expectStep([a, b], 'All done!')
  await expectNoViolations(a, 'done')
})

test('prefers-reduced-motion removes the pop animation', async ({ browser }) => {
  // "Your partner is here!" pops in as a toast on the first person's screen when the second arrives.
  for (const [motion, check] of [
    ['reduce', (d: number) => expect(d).toBeLessThan(0.001)], // the media query forces 0.01 ms
    ['no-preference', (d: number) => expect(d).toBeGreaterThan(0.05)], // and without the preference it really animates
  ] as const) {
    const a = await newPlayer(browser, { reducedMotion: motion })
    const b = await newPlayer(browser)
    const url = await createBooth(a)
    await b.goto(url)
    const pop = a.locator('.animate-pop').first()
    await expect(pop).toBeVisible()
    check(await pop.evaluate((el) => parseFloat(getComputedStyle(el).animationDuration)))
  }
})

test('mobile: nothing scrolls sideways and the pinned button is on screen without scrolling', async ({ browser }) => {
  test.setTimeout(240_000)
  const viewport = { width: 390, height: 844 }
  const a = await newPlayer(browser, { viewport })
  const b = await newPlayer(browser, { viewport })
  const noSideScroll = (page: typeof a) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)

  const url = await createBooth(a)
  expect(await noSideScroll(a)).toBe(true) // room
  await b.goto(url)
  await expectStep([a, b], 'Pick a size')
  for (const page of [a, b]) expect(await noSideScroll(page)).toBe(true) // frame

  await toShoot(a, b)
  await bothCamerasOn(a, b)
  for (const page of [a, b]) {
    expect(await noSideScroll(page)).toBe(true) // shoot, two live frames stacked
    const ready = page.getByRole('button', { name: /i'm ready/i })
    await expect(ready).toBeVisible()
    const box = await ready.boundingBox()
    expect(box?.height).toBeGreaterThanOrEqual(48) // thumb-sized
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(viewport.height) // pinned: on screen without scrolling
  }

  await shootSequence(a, b)
  for (const page of [a, b]) {
    expect(await noSideScroll(page)).toBe(true) // pick
    const next = page.getByRole('button', { name: 'Next', exact: true })
    const box = await next.boundingBox()
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(viewport.height)
  }
})
```
The file keeps its existing `AxeBuilder` and `@playwright/test` imports. `BASE` is no longer used (the old reduced-motion test needed it; the new one passes `reducedMotion` through `newPlayer`).

- [ ] **Step 6: Run the five files**

Run: `npx playwright test e2e/connect.spec.ts e2e/room.spec.ts e2e/join.spec.ts e2e/errors.spec.ts e2e/a11y.spec.ts`
Expected: all PASS. A new axe violation on a wizard screen is a real finding: fix the component (contrast, name, label), not the spec. Never add an axe `disableRules` beyond the existing `video-caption`.

- [ ] **Step 7: Commit**

```bash
git add e2e/connect.spec.ts e2e/room.spec.ts e2e/join.spec.ts e2e/errors.spec.ts e2e/a11y.spec.ts
git rm -q e2e/lobby.spec.ts
git commit -m "test: move the connection, room, error and accessibility specs to the wizard"
```

---

## Task 12: Move the shoot, photo, round and background specs; add the Pick and Done specs

**Files:**
- Modify: `e2e/capture.spec.ts`, `e2e/photos.spec.ts`, `e2e/rounds.spec.ts`, `e2e/background.spec.ts`
- Create: `e2e/pick.spec.ts`, `e2e/done.spec.ts`
- Delete: `e2e/format.spec.ts`, `e2e/takes.spec.ts`, `e2e/style.spec.ts`
- Unchanged: `e2e/segment.spec.ts`, `e2e/fixtures/*`

**Interfaces:** consumes the helpers of Task 9. Each spec below replaces the file's content in full unless it says otherwise.

- [ ] **Step 1: `e2e/capture.spec.ts`**

```ts
import { expect, test } from '@playwright/test'
import { allowCamera, closePlayers, expectRemoteVideo, expectStep, lastCapture, pressReady, roomPair, shootPair, toShoot } from './helpers'

test.afterEach(closePlayers)

test('both browsers capture the same round at essentially the same moment', async ({ browser }) => {
  const { a, b } = await shootPair(browser)
  await pressReady(a)
  await expect(a.getByRole('button', { name: 'Waiting for your partner…' })).toBeVisible()
  await pressReady(b)

  await expect(a.getByTestId('countdown')).toBeVisible()
  await expect(b.getByTestId('countdown')).toBeVisible()
  await expect(a.getByTestId('countdown')).toContainText('Get ready…')

  await expect.poll(() => lastCapture(a), { timeout: 15_000 }).not.toBeNull()
  await expect.poll(() => lastCapture(b), { timeout: 15_000 }).not.toBeNull()
  const [ca, cb] = await Promise.all([lastCapture(a), lastCapture(b)])
  expect(ca?.round).toBe(1)
  expect(cb?.round).toBe(1)
  // Same machine ⇒ same wall clock ⇒ this measures real simultaneity, not just agreement on a timestamp.
  expect(Math.abs((ca?.wallAt ?? 0) - (cb?.wallAt ?? 0))).toBeLessThan(150)
})

test('one ready each starts a run of shots that finishes on Pick by itself', async ({ browser }) => {
  test.setTimeout(120_000)
  const { a, b } = await shootPair(browser, 'duo2') // 2 frames: 4 shots
  await pressReady(a)
  await pressReady(b)
  await expect(a.getByText(/Shot 2 of 4/)).toBeVisible({ timeout: 40_000 }) // nobody pressed anything in between
  await expect.poll(() => lastCapture(a), { timeout: 60_000 }).toMatchObject({ round: 4 })
  await expect.poll(() => lastCapture(b), { timeout: 60_000 }).toMatchObject({ round: 4 })
  await expectStep([a, b], 'Pick your favorites', 30_000)
})

// Review Focus 2: a partner who drops mid-sequence stops it, and "I'm ready" starts a fresh one.
test('a partner who reloads during the countdown cancels the shot, and both can go again', async ({ browser }) => {
  test.setTimeout(150_000)
  const { a, b } = await roomPair(browser)
  await toShoot(a, b, 'polaroid')
  await allowCamera(a)
  await allowCamera(b)
  await expectRemoteVideo(a)
  await expectRemoteVideo(b)
  await pressReady(a)
  await pressReady(b)
  await expect(a.getByTestId('countdown')).toBeVisible()

  await b.reload()
  await expect(a.getByText('They left :(')).toBeVisible()
  await a.waitForTimeout(6000) // longer than the 4.5 s lead: the cancelled shot must not fire
  expect(await lastCapture(a)).toBeNull()
  await expect(a.getByText(/Shooting…/)).toHaveCount(0) // the sequence is not left running

  await expectStep([b], 'Allow your camera')
  await allowCamera(b)
  await expectRemoteVideo(a)
  await expectRemoteVideo(b)
  await pressReady(a)
  await pressReady(b)
  await expectStep([a, b], 'Pick your favorites', 90_000)
})
```

- [ ] **Step 2: `e2e/photos.spec.ts`**

```ts
import { expect, test, type Page } from '@playwright/test'
import {
  bothCamerasOn,
  closePlayers,
  createBooth,
  expectStep,
  finishedPair,
  lastCapture,
  newPlayer,
  nextStep,
  pressReady,
  shootPair,
  shootSequence,
  toShoot,
} from './helpers'

test.afterEach(closePlayers)

const FLIPPED = 'matrix(-1, 0, 0, 1, 0, 0)'
const transformOf = (page: Page, testId: string): Promise<string> => page.getByTestId(testId).evaluate((el) => getComputedStyle(el).transform)
const sizeOf = (page: Page) => page.getByRole('img', { name: 'Photo strip' }).evaluate((el: HTMLImageElement) => [el.naturalWidth, el.naturalHeight])

test('each person gets a photo strip with both photos, and can download it as PNG and JPG', async ({ browser }) => {
  test.setTimeout(180_000)
  const { a, b } = await finishedPair(browser, 'duo2')
  for (const page of [a, b]) {
    await expect(page.getByRole('img', { name: 'Photo strip' })).toBeVisible()
    expect(await sizeOf(page)).toEqual([1056, 1800])
  }

  const [pngDownload] = await Promise.all([a.waitForEvent('download'), a.getByRole('button', { name: 'Download' }).click()])
  expect(pngDownload.suggestedFilename()).toMatch(/^two-up-[A-HJ-KM-NP-Z2-9]{6}-duo2\.png$/)

  await a.getByRole('radio', { name: 'JPG' }).click()
  const [jpgDownload] = await Promise.all([a.waitForEvent('download'), a.getByRole('button', { name: 'Download' }).click()])
  expect(jpgDownload.suggestedFilename()).toMatch(/\.jpg$/)
})

test('a Polaroid is 1056 × 1032', async ({ browser }) => {
  test.setTimeout(180_000)
  const { a } = await finishedPair(browser, 'polaroid')
  expect(await sizeOf(a)).toEqual([1056, 1032])
})

// The 4-cut size (1056 × 3336) is asserted at unit level in photo.test.ts; a six-shot e2e run for it would only add minutes.
test('a 2 × 2 card is 2064 × 1800', async ({ browser }) => {
  test.setTimeout(300_000)
  const { a } = await finishedPair(browser, 'grid4')
  expect(await sizeOf(a)).toEqual([2064, 1800])
})

test('the strip stays downloadable after the partner leaves', async ({ browser }) => {
  test.setTimeout(180_000)
  const { a, b } = await finishedPair(browser, 'duo2')
  await b.close()
  await expect(a.getByText('Your partner left. Save your strip before you go.')).toBeVisible()
  await expect(a.getByRole('button', { name: 'Download' })).toBeEnabled()
})

// The room cannot move the plan with one person in it, but the strip must stay reachable.
test('if the partner leaves while you style, Next still reaches Download', async ({ browser }) => {
  test.setTimeout(180_000)
  const { a, b } = await shootPair(browser, 'polaroid')
  await shootSequence(a, b)
  await nextStep(a)
  await expectStep([a, b], 'Pick a look')
  await b.close()
  await expect(a.getByText('Waiting for your partner')).toBeVisible() // the status badge says they are gone
  await nextStep(a)
  await expectStep([a], 'All done!')
  const [download] = await Promise.all([a.waitForEvent('download'), a.getByRole('button', { name: 'Download' }).click()])
  expect(download.suggestedFilename()).toMatch(/\.png$/)
})

test('preview matches result: a mirrored camera flips both frames and the capture', async ({ browser }) => {
  const { a, b } = await shootPair(browser)
  // Chromium's fake camera reports no facingMode, which the app treats as a front camera: mirrored.
  expect(await transformOf(a, 'local-video')).toBe(FLIPPED)
  expect(await transformOf(a, 'remote-video')).toBe(FLIPPED) // THEM mirrored too (default / cam message)
  expect(await transformOf(b, 'local-video')).toBe(FLIPPED)

  await pressReady(a)
  await pressReady(b)
  await expect.poll(() => lastCapture(a), { timeout: 15_000 }).toMatchObject({ mirrored: true })
  await expect.poll(() => lastCapture(b), { timeout: 15_000 }).toMatchObject({ mirrored: true })
})

test('preview matches result: a rear camera is not flipped, on the owner and on the partner (cam message)', async ({ browser }) => {
  const a = await newPlayer(browser)
  const b = await newPlayer(browser)
  // Make B's camera claim to be a rear camera before any app code runs.
  await b.addInitScript(() => {
    const original = MediaStreamTrack.prototype.getSettings
    MediaStreamTrack.prototype.getSettings = function (this: MediaStreamTrack) {
      return { ...original.call(this), facingMode: 'environment' }
    }
  })
  const url = await createBooth(a)
  await b.goto(url)
  await expectStep([a, b], 'Pick a size')
  await toShoot(a, b)
  await bothCamerasOn(a, b)

  expect(await transformOf(b, 'local-video')).toBe('none') // B sees themself un-flipped
  await expect.poll(() => transformOf(a, 'remote-video')).toBe('none') // A's frame of B follows B's `cam` message
  expect(await transformOf(a, 'local-video')).toBe(FLIPPED) // A is still a front camera

  await pressReady(a)
  await pressReady(b)
  await expect.poll(() => lastCapture(b), { timeout: 15_000 }).toMatchObject({ mirrored: false })
  await expect.poll(() => lastCapture(a), { timeout: 15_000 }).toMatchObject({ mirrored: true })
})

// Filters live on the Style step now.
test('a filter re-renders the strip; B&W really is greyscale', async ({ browser }) => {
  test.setTimeout(180_000)
  const { a, b } = await shootPair(browser, 'duo2')
  await shootSequence(a, b)
  await nextStep(a)
  await expectStep([a, b], 'Pick a look')
  const strip = a.getByRole('img', { name: 'Photo strip' })
  await expect(strip).toBeVisible({ timeout: 30_000 })
  const before = await strip.getAttribute('src')

  await a.getByRole('radio', { name: 'B&W' }).check()
  await expect.poll(() => strip.getAttribute('src')).not.toBe(before)

  // Sample a few pixels from inside the first photo cell (x 48..1008, y 48..768) of the 1056x1800 strip.
  const greyscale = await strip.evaluate(async (img: HTMLImageElement) => {
    await img.decode()
    const c = document.createElement('canvas')
    c.width = img.naturalWidth
    c.height = img.naturalHeight
    const ctx = c.getContext('2d')!
    ctx.drawImage(img, 0, 0)
    return [[300, 300], [528, 408], [700, 500], [900, 650]].every(([x, y]) => {
      const [r, g, bl] = ctx.getImageData(x!, y!, 1, 1).data
      return Math.abs(r! - g!) <= 1 && Math.abs(g! - bl!) <= 1
    })
  })
  expect(greyscale).toBe(true)

  await nextStep(a) // the look carries over to Done
  await expectStep([a], 'All done!')
  await expect(a.getByRole('radio', { name: 'JPG' })).toBeVisible()
})
```

- [ ] **Step 3: `e2e/rounds.spec.ts`**

```ts
import { expect, test, type Page, type WebSocketRoute } from '@playwright/test'
import { bothCamerasOn, closePlayers, createBooth, expectStep, finishSession, newPlayer, pressReady, toShoot } from './helpers'

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

// Review Focus 3: a slow person misses shot after shot; the room skips each one (12 s), gives up after three, and says
// so plainly. Nothing is half-recorded, and both can go again.
test('a person whose shots arrive far too late: each is skipped, the run ends with a clear message, and going again works', async ({ browser }) => {
  test.setTimeout(240_000)
  const a = await newPlayer(browser)
  const b = await newPlayer(browser)
  const slow = { ms: 7000 } // lead is 4.5 s (3 s after the first) and the grace period 1.5 s, so 7 s is hopelessly late
  await delayCaptureFrames(b, slow)

  const url = await createBooth(a)
  await b.goto(url)
  await expectStep([a, b], 'Pick a size')
  await toShoot(a, b, 'duo2')
  await bothCamerasOn(a, b)
  await pressReady(a)
  await pressReady(b)

  // B hears about the shot after it is over: it must say so, and keep saying so while the shot is skipped.
  await expect(b.getByText('Missed that one. The next shot is coming.')).toBeVisible({ timeout: 30_000 })
  await expect(a.getByText(/Got yours\. Waiting for their photo…/)).toBeVisible() // A took its photo on time and waits for B's

  // Three skipped shots (12 s each) end the run before anything was recorded.
  for (const page of [a, b]) await expect(page.getByText("That didn't work. Go again.")).toBeVisible({ timeout: 120_000 })
  await expect(a.getByText('Connection failed')).toHaveCount(0) // … not a misleading network error
  await expect(a.getByRole('button', { name: /i'm ready/i })).toBeEnabled()
  await expect(b.getByRole('button', { name: /i'm ready/i })).toBeEnabled()

  // Both go again, this time with normal delivery, and it works.
  slow.ms = 0
  await pressReady(a)
  await pressReady(b)
  await expectStep([a, b], 'Pick your favorites', 90_000)
})

// Final review I4, adapted: the strip must never be hidden behind a connection-failure screen. There is no call at the
// Done step any more, so the hazard is the room socket ending while we hold the strip.
test('the finished strip stays reachable when the room connection is closed on us', async ({ browser }) => {
  test.setTimeout(240_000)
  const a = await newPlayer(browser)
  const b = await newPlayer(browser)
  const handle: { ws: WebSocketRoute | null } = { ws: null }
  await a.routeWebSocket(/\/api\/rooms\/[^/]+\/ws/, (ws) => {
    handle.ws = ws
    const server = ws.connectToServer()
    ws.onMessage((m) => server.send(m))
    ws.onClose((code, reason) => void server.close({ code, reason }))
    server.onMessage((m) => ws.send(m))
    server.onClose((code, reason) => void ws.close({ code, reason }))
  })
  const url = await createBooth(a)
  await b.goto(url)
  await expectStep([a, b], 'Pick a size')
  await toShoot(a, b, 'polaroid')
  await bothCamerasOn(a, b)
  await finishSession(a, b)
  const strip = a.getByRole('img', { name: 'Photo strip' })
  await expect(strip).toBeVisible({ timeout: 30_000 })

  await handle.ws?.close({ code: 4000, reason: 'test: booth expired' }) // the page would normally show "BOOTH CLOSED."
  await expect(a.getByText('Connection lost')).toBeVisible()
  await expect(strip).toBeVisible()
  await expect(a.getByText('BOOTH CLOSED.')).toHaveCount(0)
  const [download] = await Promise.all([a.waitForEvent('download'), a.getByRole('button', { name: 'Download' }).click()])
  expect(download.suggestedFilename()).toMatch(/\.png$/)
})

// Review I4: a photo-complete lost on its way to the server must not strand a person silently. The tab re-sends it when
// the room says it has not counted it; either way the run carries on to Pick.
test('a photo-complete that never reaches the server is recovered, and the run still finishes', async ({ browser }) => {
  test.setTimeout(240_000)
  const a = await newPlayer(browser)
  const b = await newPlayer(browser)
  let dropped = false
  await a.routeWebSocket(/\/api\/rooms\/[^/]+\/ws/, (ws) => {
    const server = ws.connectToServer()
    ws.onMessage((m) => {
      if (!dropped && typeof m === 'string' && m.includes('"photo-complete"')) {
        dropped = true // swallowed, as if the socket were reconnecting at that moment
        return
      }
      server.send(m)
    })
    ws.onClose((code, reason) => void server.close({ code, reason }))
    server.onMessage((m) => ws.send(m))
    server.onClose((code, reason) => void ws.close({ code, reason }))
  })

  const url = await createBooth(a)
  await b.goto(url)
  await expectStep([a, b], 'Pick a size')
  await toShoot(a, b, 'duo2')
  await bothCamerasOn(a, b)
  await pressReady(a)
  await pressReady(b)

  await expectStep([a, b], 'Pick your favorites', 120_000)
  expect(dropped).toBe(true)
})
```

- [ ] **Step 4: `e2e/background.spec.ts`**

Keep the file header (the MJPEG fake camera, `strip`, `pixels`) as it is, and change its two imports to
```ts
import { expect, test, type Browser, type Page } from '@playwright/test'
import { closePlayers, expectStep, nextStep, shootPair, shootSequence } from './helpers'
```
and replace the three tests with the versions below. Backgrounds live on the Style step, so each test goes Shoot → Pick → Style before choosing.
```ts
/** Both at the Style step after one polaroid shot (one "Both" frame). */
async function atStyle(browser: Browser) {
  const { a, b } = await shootPair(browser, 'polaroid')
  await shootSequence(a, b)
  await nextStep(a)
  await expectStep([a, b], 'Pick a look')
  await expect(strip(a)).toBeVisible({ timeout: 30_000 })
  return { a, b }
}

test('choosing a background puts both people on it, and the strip downloads', async ({ browser }) => {
  test.setTimeout(300_000)
  const { a, b } = await atStyle(browser)
  const before = await strip(a).getAttribute('src')

  await a.getByRole('radio', { name: 'YELLOW' }).click()
  await expect.poll(() => strip(a).getAttribute('src'), { timeout: 90_000 }).not.toBe(before)

  // The cell starts at x = 48. A person's box is at most 55 % of the cell wide and centred at 30 % / 70 %, so it can
  // never start before 24 px into the cell: 12 px in, at mid-height, only the background shows — yellow #ffe600.
  const [corner] = await pixels(a, [[60, 408]])
  expect(corner).toEqual([255, 230, 0])
  // …and the people really are there: along the bottom of the cell, most pixels are the white suit, not the background.
  const bottom = await pixels(a, Array.from({ length: 15 }, (_, i): [number, number] => [48 + 140 + i * 45, 48 + 690]))
  expect(bottom.filter(([r, g, bl]) => !(r === 255 && g === 230 && bl === 0)).length).toBeGreaterThanOrEqual(8)
  expect(await strip(a).evaluate((el: HTMLImageElement) => [el.naturalWidth, el.naturalHeight])).toEqual([1056, 1032])

  // Style is per person: B is unaffected, and A's choice survives going on to Done.
  await expect(b.getByRole('radio', { name: 'SIDE BY SIDE' })).toBeChecked()
  await expect(a.getByText('Cutouts are made on your device.')).toBeVisible()
  const styled = await strip(a).getAttribute('src')
  await nextStep(a)
  await expectStep([a, b], 'All done!')
  await expect.poll(() => strip(a).getAttribute('src')).toBe(styled)

  const [download] = await Promise.all([a.waitForEvent('download'), a.getByRole('button', { name: 'Download' }).click()])
  expect(download.suggestedFilename()).toMatch(/\.png$/)
})

// Review Focus 5 of the earlier feature, unchanged: the cutout tool cannot load.
test("if the cutout tool can't load, the cell falls back to side by side and download still works", async ({ browser }) => {
  test.setTimeout(300_000)
  const { a, b } = await atStyle(browser)
  const before = await strip(a).getAttribute('src')

  await a.route('**/vendor/**', (route) => route.abort()) // the model and the WASM are unreachable
  await a.getByRole('radio', { name: 'YELLOW' }).click()

  await expect(a.getByText("Couldn't cut you out. Showing side by side.")).toBeVisible({ timeout: 60_000 })
  expect(await strip(a).getAttribute('src')).toBe(before) // the strip is still the side-by-side one
  await nextStep(a)
  await expectStep([a, b], 'All done!')
  await expect(a.getByRole('button', { name: 'Download' })).toBeEnabled()
  const [download] = await Promise.all([a.waitForEvent('download'), a.getByRole('button', { name: 'Download' }).click()])
  expect(download.suggestedFilename()).toMatch(/\.png$/)

  // Review I3: the network comes back, and choosing another background must try again (not sit on the old failure).
  await a.unroute('**/vendor/**')
  await a.getByRole('button', { name: 'Back', exact: true }).click()
  await expectStep([a, b], 'Pick a look')
  await a.getByRole('radio', { name: 'PINK' }).click()
  await expect(a.getByText("Couldn't cut you out. Showing side by side.")).toHaveCount(0, { timeout: 60_000 })
  await expect.poll(() => strip(a).getAttribute('src'), { timeout: 60_000 }).not.toBe(before)
  const [pink] = await pixels(a, [[60, 408]])
  expect(pink).toEqual([255, 79, 163])
})

test('a strip with no "Both" frame does not offer a background', async ({ browser }) => {
  test.setTimeout(300_000)
  const { a, b } = await shootPair(browser, 'polaroid')
  await shootSequence(a, b)
  await a.getByRole('group', { name: 'Who is in frame 1' }).getByRole('radio', { name: 'Just you' }).click()
  await expect(b.getByRole('group', { name: 'Who is in frame 1' }).getByRole('radio', { name: 'Just them' })).toBeChecked()
  await nextStep(a)
  await expectStep([a, b], 'Pick a look')
  await expect(a.getByRole('radio', { name: 'YELLOW' })).toHaveCount(0)
})
```
(`Back` in the second test is the stepper/ActionBar Back from Done to Style; the "style carries over, then Back" path also proves the lifted style state.)

- [ ] **Step 5: `e2e/pick.spec.ts` (new)**

```ts
import { expect, test, type Page } from '@playwright/test'
import { closePlayers, expectStep, nextStep, pressReady, shootPair, shootSequence } from './helpers'

test.afterEach(closePlayers)

/** The aria-label of a frame button tells which shot is in it: "Frame 1, shot 3". */
const frameShot = async (page: Page, frame: number): Promise<string> => {
  const button = page.getByRole('button', { name: new RegExp(`^Frame ${frame},`) })
  return (await button.getAttribute('aria-label')) ?? ''
}
const shotButton = (page: Page, n: number) => page.getByRole('button', { name: new RegExp(`^Shot ${n}(,|$)`) })
const frameButton = (page: Page, n: number) => page.getByRole('button', { name: new RegExp(`^Frame ${n},`) })

// Review Focus 5: both people edit, both screens converge, a used shot swaps, and "you / them" read from each side.
test('both people pick: fill, swap, and who is in each frame reads correctly on each screen', async ({ browser }) => {
  test.setTimeout(180_000)
  const { a, b } = await shootPair(browser, 'duo2') // 2 frames, 4 shots
  await shootSequence(a, b)

  // The frames start filled with the first shots.
  for (const page of [a, b]) {
    expect(await frameShot(page, 1)).toContain('shot 1')
    expect(await frameShot(page, 2)).toContain('shot 2')
    await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeEnabled()
  }

  // A taps an unused shot, then frame 1: B's screen follows.
  await shotButton(a, 3).click()
  await expect(a.getByText('Now tap a frame.')).toBeVisible()
  await frameButton(a, 1).click()
  await expect.poll(() => frameShot(b, 1)).toContain('shot 3')
  expect(await frameShot(a, 2)).toContain('shot 2')

  // B taps shot 2 (it is in frame 2), then frame 1: the two frames swap, on both screens.
  await shotButton(b, 2).click()
  await frameButton(b, 1).click()
  for (const page of [a, b]) {
    await expect.poll(() => frameShot(page, 1)).toContain('shot 2')
    await expect.poll(() => frameShot(page, 2)).toContain('shot 3')
  }

  // "Just you" is slot a's side for A and slot b's side for B, so one frame reads the other way round on the other screen.
  await a.getByRole('group', { name: 'Who is in frame 1' }).getByRole('radio', { name: 'Just you' }).click()
  await expect(a.getByRole('group', { name: 'Who is in frame 1' }).getByRole('radio', { name: 'Just you' })).toBeChecked()
  await expect(b.getByRole('group', { name: 'Who is in frame 1' }).getByRole('radio', { name: 'Just them' })).toBeChecked()
  await b.getByRole('group', { name: 'Who is in frame 2' }).getByRole('radio', { name: 'Just you' }).click()
  await expect(a.getByRole('group', { name: 'Who is in frame 2' }).getByRole('radio', { name: 'Just them' })).toBeChecked()
})

test('"Shoot more" adds spare shots and keeps the picks', async ({ browser }) => {
  test.setTimeout(240_000)
  const { a, b } = await shootPair(browser, 'duo2')
  await shootSequence(a, b)
  await expect(a.getByRole('button', { name: /^Shot \d/ })).toHaveCount(4)
  const before = await frameShot(a, 1)

  await a.getByRole('button', { name: 'Shoot more' }).click()
  await expectStep([a, b], 'Ready to shoot?')
  await pressReady(a)
  await pressReady(b)
  await expectStep([a, b], 'Pick your favorites', 90_000)
  await expect(a.getByRole('button', { name: /^Shot \d/ })).toHaveCount(7) // 3 more
  expect(await frameShot(a, 1)).toBe(before) // the frames kept their shots
  await nextStep(a)
  await expectStep([a, b], 'Pick a look')
})
```

- [ ] **Step 6: `e2e/done.spec.ts` (new; replaces `style.spec.ts`)**

```ts
import { expect, test } from '@playwright/test'
import { closePlayers, expectStep, finishedPair } from './helpers'

test.afterEach(closePlayers)

// Review Focus 6: "Make another" returns both to Frame with the size kept, and never takes the other person's strip away.
test('Make another goes back to Frame with the same size; the partner keeps their strip and is told', async ({ browser }) => {
  test.setTimeout(240_000)
  const { a, b } = await finishedPair(browser, 'duo2')
  await expect(b.getByRole('img', { name: 'Photo strip' })).toBeVisible()

  await a.getByRole('button', { name: 'Make another' }).click()
  await expectStep([a], 'Pick a size')
  await expect(a.getByRole('radio', { name: /2 cut/i })).toBeChecked()

  // B was looking at the strip: it stays, with a notice and a working Download.
  await expect(b.getByText('Your partner started a new strip. Download yours first.')).toBeVisible()
  await expect(b.getByRole('img', { name: 'Photo strip' })).toBeVisible()
  const [download] = await Promise.all([b.waitForEvent('download'), b.getByRole('button', { name: 'Download' }).click()])
  expect(download.suggestedFilename()).toMatch(/\.png$/)
  await b.getByRole('button', { name: 'Continue' }).click()
  await expectStep([b], 'Pick a size')
  await expect(b.getByRole('radio', { name: /2 cut/i })).toBeChecked()
})

// A reload loses this tab's photos; the partner's strip must survive the start-over.
test('a reloaded tab says its photos are gone, and starting over does not take the strip away from the partner', async ({ browser }) => {
  test.setTimeout(240_000)
  const { a, b, url } = await finishedPair(browser, 'polaroid')

  b.on('dialog', (dialog) => void dialog.accept()) // the "photos live only in this tab" beforeunload prompt
  await b.goto(url)
  await expectStep([b], 'Your photos were lost when this page reloaded')
  await b.getByRole('button', { name: 'Start over' }).click()

  await expect(a.getByText('Your partner started a new strip. Download yours first.')).toBeVisible()
  // What A sees is now only a snapshot, and A's store is empty: closing the tab must still warn that the strip would be lost.
  expect(
    await a.evaluate(() => {
      const event = new Event('beforeunload', { cancelable: true })
      window.dispatchEvent(event)
      return event.defaultPrevented
    }),
  ).toBe(true)
  const [download] = await Promise.all([a.waitForEvent('download'), a.getByRole('button', { name: 'Download' }).click()])
  expect(download.suggestedFilename()).toMatch(/\.png$/)
  await a.getByRole('button', { name: 'Continue' }).click()
  await expectStep([a, b], 'Pick a size')
})
```
Then delete the obsolete specs:
```bash
git rm e2e/format.spec.ts e2e/takes.spec.ts e2e/style.spec.ts
```

- [ ] **Step 7: Run each file, then the type check**

Run, one at a time, expecting all PASS:
```bash
npx playwright test e2e/capture.spec.ts
npx playwright test e2e/photos.spec.ts
npx playwright test e2e/rounds.spec.ts
npx playwright test e2e/background.spec.ts
npx playwright test e2e/pick.spec.ts
npx playwright test e2e/done.spec.ts
```
Then `npm run typecheck`. Expected: exit 0 — `e2e/` now compiles against the new helpers and the whole app type-checks again.

If a test fails because of timing (a shot that takes longer than a spec's timeout on a slow machine), raise the spec's `test.setTimeout`, not the app's constants. If it fails because the app misbehaves, fix the app and say so in the commit body.

- [ ] **Step 8: Commit**

```bash
git add e2e/capture.spec.ts e2e/photos.spec.ts e2e/rounds.spec.ts e2e/background.spec.ts e2e/pick.spec.ts e2e/done.spec.ts
git commit -m "test: move the shoot, photo, round and background specs to the wizard and add pick and done specs"
```
(The three deletions from Step 6 are already staged; the commit includes them. Check `git status` first.)

---

## Task 13: README, device checklist and the final gate

**Files:**
- Modify: `README.md`

**Interfaces:** none.

- [ ] **Step 1: README**

In `README.md`:
1. Replace the section **"Format, takes and cutouts"** with **"The wizard, shots and cutouts"**. Say, in short paragraphs: the steps are Frame · Shoot · Pick · Style · Done; Next and Back are either person's and move both screens (never while shots are running); the camera is asked for only at the Shoot step; one "I'm ready" each starts a run of shots (frames + 2, "Shoot more" adds 3, at most 12), the server schedules every shot (first lead 4.5 s, then 3 s) and skips one that does not complete in 12 s (three skips end the run); Pick fills frames by "tap a shot, then a frame" with swap, and "Both / Just you / Just them"; backgrounds and filters are per person and live on Style (cutouts still happen on the device, with the same fallback); Done offers Download, Share and Make another. Keep the existing paragraph on the self-hosted model, the licence and the 25 MiB asset limit unchanged.
2. In **"Manual test checklist (needs real devices)"** add these rows (leave the existing ones that still apply):
   - On a phone, from "Start a room" to a downloaded strip using only: share a code, tap a size, Next, allow the camera, I'm ready once, Next, Next, Download.
   - The bottom bar clears a notch and the browser's own bottom bar; Next/Back/I'm ready are reachable with one thumb.
   - Two live frames stacked on a phone are large enough to frame yourself; the countdown numerals are readable over them.
   - The rhythm of the shots (3 s between shots) feels right on a real network; a slow phone is skipped, not stuck.
   - The camera light goes off when you reach Style.
   - Copy: ask someone who has not seen the app whether each screen says what to do.
3. In **"Verification status"** replace the numbers with the real ones from this run (unit + worker count from `npm test`, Playwright count from `npm run test:e2e`) and keep the honest list of what is verified only on a desktop with a fake camera.
4. Search the README for the old flow words (`TAKE`, `RETAKE`, `KEEP THIS ONE`, `format step`, `READY` as a per-cell press) and update every mention.

- [ ] **Step 2: Mark the design spec as implemented**

In `docs/superpowers/specs/2026-10-08-wizard-flow-design.md` change `Status: **draft for review**` to `Status: **implemented**`.

- [ ] **Step 3: The final gate**

Run, expecting every command to exit 0:
```bash
npm run check
npm run build
npm run test:e2e
```
Record the three results (counts) for the final report. If `npm run test:e2e` has a failure, it is not done: fix or report it — do not skip a spec.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/superpowers/specs/2026-10-08-wizard-flow-design.md
git commit -m "docs: describe the wizard flow and add its device checklist"
```
