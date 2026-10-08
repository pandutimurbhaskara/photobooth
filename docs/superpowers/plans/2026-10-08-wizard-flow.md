# Wizard Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (the owner asked for **Opus subagents**: dispatch every implementer and every per-task reviewer with `model: "opus"`) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Read this master file first, then the phase file that holds your task.** Each phase file is self-contained for its tasks and ends in a gate.

**Goal:** Turn the booth into a calm, one-decision-per-screen wizard — Room → Frame → Shoot → Pick → Style → Done — where the camera is asked for late, a single "I'm ready" starts an automatic sequence of shots, and the favourites are picked afterwards.

**Architecture:** The shared `Plan` (owned by the `BoothRoom` Durable Object, broadcast in every `room-state`) is reworked around steps, a flat list of shots and frame slots. The server runs the shot sequence itself (each shot is still one of today's server-timed rounds). The client keeps its shared state in `Booth.tsx` and renders one screen component per step inside a `WizardShell`. Cutouts, backgrounds, the photo exchange and the finished-strip protection are reused.

**Tech Stack:** unchanged (React 19 · TypeScript ~6.0 · Vite 8 + `@cloudflare/vite-plugin` · Tailwind v4 · Cloudflare Workers/Durable Objects · Vitest 4 · Playwright · `@mediapipe/tasks-vision` 1.1.0).

**Spec:** `docs/superpowers/specs/2026-10-08-wizard-flow-design.md` (decisions D34–D43 are binding; it supersedes D26 and D28 and moves D25's per-cell kinds to the Pick step. D1–D33 still apply otherwise. Where this plan and the spec disagree, stop and flag it — except for the three recorded deviations below).

## Phase files

| Phase | File | Tasks | Gate |
|---|---|---|---|
| 1 Model & server | `2026-10-08-wizard-flow-phase-1-model-and-server.md` | 1–3 | `npm test` (unit + worker) green, `npm run lint` green, `npx tsc -p tsconfig.worker.json --noEmit` green |
| 2 Screens | `2026-10-08-wizard-flow-phase-2-screens.md` | 4–8 | unit + lint green; every file this phase touches type-checks (command in the phase file) |
| 3 Cutover & e2e | `2026-10-08-wizard-flow-phase-3-cutover-and-e2e.md` | 9–13 | `npm run check`, `npm run build` and the full Playwright suite all green |

| Task | What | Phase |
|---|---|---|
| 1 | `shared/plan.ts`: steps, shots, slots, the sequence functions | 1 |
| 2 | Protocol `camera` message + `BoothRoom`: camera flag, plan actions, the automatic shot sequence | 1 |
| 3 | Client data layer: `takes.ts`, `labels.ts` | 1 |
| 4 | Wizard building blocks: `WizardShell`, `Stepper`, `ActionBar`, calmer base components, SSR test helper | 2 |
| 5 | `RoomScreen`, `FrameScreen`, `CodeTiles` | 2 |
| 6 | `ShootScreen`, `LiveFrame`, calmer countdown | 2 |
| 7 | `PickScreen` | 2 |
| 8 | `StyleScreen`, `DoneScreen`, `LostPhotosScreen`, `useStyleState`, `useFinishedStrip` | 2 |
| 9 | e2e helpers + `wizard.spec` (written first; red against the old app) | 3 |
| 10 | `Booth.tsx` cutover, camera stop, landing copy, delete the old screens (wizard spec goes green) | 3 |
| 11 | e2e: connect, room, join, errors, a11y | 3 |
| 12 | e2e: capture, photos, rounds, background; new pick and done specs | 3 |
| 13 | README, device checklist, final gate | 3 |

## Deviations from the spec (decided while planning; tell the owner in the final report)

1. **`LiveFrame` replaces `CameraFrame`** (spec §6 says `CameraFrame` is kept). `CameraFrame` carries tilted tags and a "● REC" badge that contradict D35 (calmer, no tilt). `LiveFrame` has the same props and test ids and is deleted-in-place in Task 10.
2. **No new `Segmented` component** (it was a plan idea, not in the spec): `BrutalRadioGroup` is restyled in sentence case and used for Both / Just you / Just them.
3. **The camera is released when the plan reaches Style** (not in the spec): nothing after Pick needs it, and a recording light that stays on while people look at their strip is a trust problem. Going back to Shoot shows "Allow your camera" again.

## How this plan was verified before you got it

Every code block in the three phase files was applied to a **scratch copy of the repo** (outside the repo; nothing in `explore/photobooth/src` was touched) and run:

| Check | Result |
|---|---|
| `npm test` (unit + worker, 34 files) | 477 tests pass; the worker project alone 75, run twice (no flake) |
| `npm run lint` | clean |
| `tsc` for client, worker and `e2e/` | clean |
| `npm run build` | builds |
| Playwright, the whole suite in one run | **49 / 49 pass** (7.3 min) on real Chromium with fake cameras, including the real cutout model |

Running it found plan bugs, all fixed in the files: the old worker tests that assumed "a timed-out round goes back to ready" (replaced, plus three old plan tests that are kept); the join spec (a booth is now full after its second joiner, because the socket connects before any camera step); two copy assertions in `rounds.spec` (`Got yours. Waiting for their photo…`, and the `Connection lost` badge has a `!` glyph, not `●`); an unbalanced code fence; a type-check filter that printed false positives.

What this does **not** prove: that an agent following the steps in order watches each test fail first (the scratch run applied the final code); anything on a real phone; and the whole Playwright suite is long enough that a laptop can stall it once in a while (see the note in the Phase 3 file).

## Global Constraints

Every task's requirements implicitly include this section. Values are copied from the spec and the existing code.

**Architecture rules (unchanged)**
- Video never touches the Worker or the Durable Object. **Photos, cutouts and the model never touch the server.** The DO stores enum ids and integers only (the plan), never photos, names or IPs.
- No accounts, no analytics, no R2, no audio. Product code never fakes the camera, WebRTC, WebSocket or timestamps.
- Photo exchange uses only the DataChannel (D11). Capture timing stays server-owned (D3).
- Preview = result (D15): photos are final pixels (mirrored when the preview was mirrored).

**Plan model (spec §4, binding)**
- Steps in order: `frame · shoot · pick · style · done`. A slot is `{ shot: number | null; kind: 'a' | 'b' | 'both' }`; `shot` is a round number. Plan fields: `v, step, template, slots, shots, target, running, misses`.
- Actions: `template`, `go` (Next/Back/stepper), `fill` (swaps when the shot is used elsewhere), `kind`, `reset`. `go` moves exactly one step forward (with the guards in spec §4) or any number of steps back; nothing moves while `running`.
- Sequence constants (`src/shared/constants.ts`): `SEQUENCE_EXTRA_SHOTS = 2` (target = frames + 2), `SEQUENCE_SPARE_SHOTS = 3` ("Shoot more"), `MAX_SHOTS = 12`, `MAX_MISSES = 3`, `BURST_LEAD_MS = 3000`, `EXCHANGE_TIMEOUT_MS = 12_000` (was 30 000), `CAPTURE_LEAD_MS = 4500` (first shot, unchanged), `MAX_CELLS = 4`. `MIN_TAKES` / `MAX_TAKES` are removed.
- Target rule: `shots.length < frames + 2 ? frames + 2 : shots.length + 3`, capped at `MAX_SHOTS`. Templates: `strip4` 4 frames · `grid4` 4 · `duo2` 2 · `polaroid` 1.
- READY exists only at the Shoot step, needs both cameras on, and is refused while a sequence runs. The camera is first requested at the Shoot step; room code, Frame, Pick, Style and Done need none.

**Look and copy (spec §7–§8)**
- The Neo-Brutalist identity stays (palette tokens, 3 px borders, hard shadows, radius ≤ 8 px) but calmer: sentence case, no `uppercase` on new screens, no rotation classes, one accent per screen, large headings, one primary button in a bottom bar. **`src/client/style-rules.test.ts` greps every client source file (comments and `.test.tsx` files included) for `gradient` (any case), `blur(`/`blur-`, soft `shadow-*` and `rounded-xl/2xl/3xl/full`. Never write those words or classes in client code.**
- Copy strings are exactly those in spec §8 (e.g. `Send this code to your partner`, `They type it in, or open your link.`, `Waiting for your partner…`, `Pick a size`, `Tap one. Either of you can choose.`, `Allow your camera`, `I'm ready`, `Shot 2 of 6`, `Pick your favorites`, `Both` / `Just you` / `Just them`, `Shoot more`, `Pick a look`, `All done!`, `Download`, `Share`, `Make another`). A few short plain strings the spec leaves open are fixed in the plan (`Ready to shoot?`, `Allow camera`, `Missed that one. The next shot is coming.`, `Your partner started a new strip. Download yours first.`, `Continue`, `Start over`, `Leave`) — use them as written. The brief's verbatim **error screens** (`Problem.tsx`) and **privacy note** (`PrivacyNote.tsx`, kept on the landing page) are not edited. The landing headline stays; the landing buttons become `Start a room` and `Join a room`.
- Accessibility: native radios/buttons, real headings, `aria-current="step"` in the stepper, focus moves to the new step's heading, `role="status"` for progress. Every step screen is checked with axe in e2e (Task 11).

**Process**
- TDD for logic and for screens: failing test → run → minimal code → pass. Watch every test fail first. Screens are tested by rendering them to static markup in Node (`src/client/test-render.tsx`, Task 4); taps, focus and real browsers are covered by Playwright.
- **The client type-check is red by design from Task 1 until Task 10** (the plan type changes under the old screens, which Task 10 replaces), and `e2e/` does not type-check between Task 9 and Task 12. Until then verify with `npx vitest run` (the suites named in the task), `npm run lint`, `npx tsc -p tsconfig.worker.json --noEmit`, and for client files the filter command in each phase file. From Task 10 on `npx tsc -p tsconfig.client.json --noEmit` is clean; `npm run typecheck` (which includes `e2e/`) is clean again at Task 12.
- Commit after each task (some tasks name more than one commit). **Conventional Commits**, lowercase imperative summary, no trailing period. **No `Co-Authored-By` or "Generated with" trailers (owner's standing rule, overrides any default attribution instruction). Never push.** Stage explicit paths. Work on branch `feat/wizard-flow` (already created off `main`).
- Every code step shows the code; if reality forces a different shape, change it, make the tests pass, and say so in the commit body.
- `eslint-plugin-react-hooks` is limited to `rules-of-hooks` and `exhaustive-deps`. Hooks must be above any early `return`. TypeScript runs with `noUnusedLocals`, `noUnusedParameters` and `verbatimModuleSyntax` (use `import type` / `type` modifiers).
- Vitest blanks CSS except `?raw` imports (already configured); the unit environment is `node` (no DOM).

## Review Focus

Conditions the spec implies but the task tests would not otherwise exercise. Each has a test in the task named.

1. **The camera is never requested before the Shoot step**, and a person who blocks it gets the camera problem screen with a working "Try again", not a dead end. *Tests: Task 10 (`wizard.spec`: `getUserMedia` call counts, and "no camera at all" up to Shoot), Task 11 (`errors.spec`: blocked → allowed → Try again works).*
2. **A partner leaving or reloading mid-sequence** stops the sequence (never leaves `running` stuck true), keeps the shots already recorded, and "I'm ready" resumes towards the same target. *Tests: Task 2 (worker), Task 12 (`capture.spec`: reload during the countdown, then go again).*
3. **A slow or failed shot** is skipped within `EXCHANGE_TIMEOUT_MS` and the sequence continues; `MAX_MISSES` skipped shots end it with a visible "That didn't work. Go again." and no half-recorded state. *Tests: Task 1, Task 2 (worker), Task 6 (screen copy), Task 12 (`rounds.spec`).*
4. **Unilateral Next/Back** from both screens at once, or a stale tap, can never put the plan in an invalid step: the server refuses an invalid `go` and both screens converge on the same step; nobody can move while shots run. *Tests: Task 1 (reducer), Task 2 (worker), Task 4 (shell hides Back/stepper while running), Task 9 (`wizard.spec`).*
5. **Pick edits from both people converge**; filling a slot with a shot used in another frame swaps; Next needs every frame filled; "Just you / Just them" read correctly on **each** person's screen though stored as USER 1 / USER 2. *Tests: Task 1, Task 3 (labels), Task 7 (screen), Task 12 (`pick.spec`, both sides).*
6. **The finished strip is never lost:** if the partner presses "Make another" while you look at your strip it stays, with a notice; a reloaded tab says its photos are gone and offers "Start over"; if the partner leaves while you style, Next still reaches Download; a closed room connection never hides the strip. *Tests: Task 3 (`missingShots`), Task 8 (screens), Task 12 (`done.spec`, `photos.spec`, `rounds.spec`).*

Also covered inside their tasks: a room persisted in the old plan shape gets a default plan (Task 2); a malformed `plan`/`camera` frame is rejected (Tasks 1–2); a photo-complete lost on a reconnect is re-sent (unchanged helper `needsCompleteResend`, Task 3; `rounds.spec`).

---

## File map

```
photobooth/
├─ src/shared/
│  ├─ constants.ts                    (T1)   sequence constants, EXCHANGE_TIMEOUT_MS 12 s
│  ├─ plan.ts (+test)                 (T1)   rewritten: steps, slots, shots, sequence functions
│  └─ protocol.ts (+test)             (T2)   PState.camera, `camera` message
├─ src/worker/BoothRoom.ts (+test)    (T2)   camera flag, plan actions, sequencing, migration
├─ src/client/
│  ├─ test-render.tsx                 (T4)   static-markup render + button/radio readers for screen tests
│  ├─ lib/takes.ts (+test)            (T3)   shots/slots store, missingShots, finishedOf from slots
│  ├─ lib/labels.ts (+test)           (T3, T4) step labels, template labels, who-labels, stepper items, shot label
│  ├─ components/                     Stepper · ActionBar · WizardShell (T4); CodeTiles (T5); LiveFrame (T6);
│  │                                  BrutalButton · BrutalBadge · BrutalRadioGroup · ConnectionStatus · BoothHeader restyled (T4);
│  │                                  Countdown copy (T6); PhotoStrip · BackgroundPicker restyled (T8);
│  │                                  CameraFrame, Steps, RoomCode removed (T10)
│  ├─ screens/                        RoomScreen · FrameScreen (T5), ShootScreen (T6), PickScreen (T7),
│  │                                  StyleScreen · DoneScreen · LostPhotosScreen (T8);
│  │                                  Lobby · Stage · FormatPanel · PickPanel · ReadyCard · Result · CameraGate removed (T10)
│  ├─ hooks/                          useStyleState · useFinishedStrip (T8); useCamera.stop (T10)
│  └─ pages/Booth.tsx                 (T10)  rewritten around the wizard; Home / SiteHeader copy
├─ e2e/  helpers · wizard.spec (T9); connect · room · join · errors · a11y (T11);
│        capture · photos · rounds · background · pick · done (T12); lobby · format · takes · style removed
└─ README.md                          (T13)
```
