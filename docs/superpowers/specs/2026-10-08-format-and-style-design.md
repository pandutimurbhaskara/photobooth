# Format & Style — Design Spec

Date: 2026-10-08 · Status: **draft for review** · Builds on `2026-10-07-photobooth-design.md` (the "base spec"; its D-numbers are cited as D1–D23).
Source: the owner's request of 2026-10-08 plus four reference screenshots (a 5-step wizard: Frame → Shoot → Pick → Style → Done).

The base spec's rules are unchanged unless §2 says otherwise: video is WebRTC-only, photos never touch the server, no accounts, Neo-Brutalist look, preview = result (D15).

---

## 1. What we are adding

Today a booth takes one capture, shows a strip, and offers a layout radio. This change makes the session a short guided flow, shared by both people:

1. **FORMAT** — either person picks a template (4-cut strip, 2×2, 2-cut, Polaroid) and, for **each cell**, whose picture goes there: **USER 1**, **USER 2**, or **TOGETHER**.
2. **SHOOT + PICK, cell by cell** — each cell gets 2–3 synchronized takes; both people then choose the best take for that cell.
3. **STYLE / DONE** — a finished strip, with a background picker for TOGETHER cells, the existing colour filter, file type, download/share, and **retake of any single cell** that isn't good enough.

A **TOGETHER** cell is one picture that combines both people: each person is cut out of their own photo (in the browser) and placed on one chosen background.

**Success =** two browsers can pick a format, shoot every cell with 2–3 takes, keep the best take per cell, see a strip whose TOGETHER cells show both people cut out on a chosen background, retake one cell, and download — with no photo or cutout ever leaving the browsers.

## 2. Decisions (additions and supersessions)

| # | Decision | Why |
|---|---|---|
| D24 | **Templates replace the layout radio.** Four, as in the reference: `strip4` (1×4), `grid4` (2×2), `duo2` (1×2), `polaroid` (1×1). All cells keep the existing 4:3 cell (960×720), so the live frame still matches the result. The old `horizontal` 2×1 is **dropped**; `vertical`→`duo2`, `grid`→`grid4`. Geometry is table-driven, so re-adding a template is one table row | Owner's screenshots. Dropping `horizontal` is an assumption (§12) |
| D25 | **Cell kinds** `a` · `b` · `both`, labelled USER 1 / USER 2 / TOGETHER. USER 1 = slot `a` (the booth creator), USER 2 = slot `b`; each screen appends "(YOU)" to its own. Picking a template sets every cell to `both`. The initial state has **no template**, so READY stays disabled until someone picks one | Slots are already stable across reconnects (they follow `participantId`). Every take still captures and exchanges **both** photos; a USER 1 cell simply ignores USER 2's, so the capture and exchange path is unchanged |
| D26 | **Takes:** 2 minimum, 3 maximum per cell. After the 2nd take both people see the takes side by side and tap one to keep (the latest is preselected); "ONE MORE TAKE" adds a 3rd. **Supersedes D13** (grid needs 2 rounds) and **D14** (only the last 2 rounds kept) | Owner: "on each cell took 2–3 photo" |
| D27 | **The Durable Object owns a small shared `Plan`** (template, kinds, current cell, stage, take rounds, kept round per cell). Clients send *actions*; the server validates, applies and broadcasts the plan inside every `room-state`. Photos stay client-only — the server only ever stores round numbers and enum ids | Survives reconnects through the existing join snapshot, one authority when both tap at once, no new transport. P2P sync was rejected: the plan would die with every rebuilt peer connection |
| D28 | **Retake a cell** from the final screen: the cell's takes and kept photo are dropped and it goes through shoot → pick again (2–3 takes). Other cells are untouched | Owner: "able to retake the grid that is not satisfying" |
| D29 | **Style is per person and local**: background, filter and file type are not synced. Two people may download slightly different strips | Segmentation is local anyway; zero extra server surface. Format and kinds *are* shared because shooting needs them |
| D30 | **Cutout engine: MediaPipe selfie segmenter**, self-hosted. `@mediapipe/tasks-vision` 1.1.0 (Apache-2.0), WASM ≈13 MB, plus `selfie_segmenter.tflite` (249,537 bytes, float16). Loaded lazily the first time someone picks a real background. Needs `'wasm-unsafe-eval'` added to `script-src` in `public/_headers` | Made for one person in a selfie — each phone holds exactly that. Alternatives: `@imgly/background-removal` (tens of MB, licence needs checking); chroma key (needs a physical green screen) |
| D31 | **Backgrounds are procedural and original** (`lib/backgrounds.ts`): about 12–16 flat patterns and colour blocks drawn on canvas in the app's palette. The thumbnail and the strip use the same draw function. One background applies to all TOGETHER cells. The first choice, `none`, means "side by side, no cutout" and is the default | No licensing, no image weight, preview = result, and nobody downloads 13 MB unless they ask for a cutout |
| D32 | **Fallback is always the split cell.** TOGETHER with `none` — or whenever the model fails to load, times out (15 s) or errors — draws USER 1 and USER 2 side by side, each cover-cropped to half the cell, with a notice. Cutout failure never blocks download | Phase 1 ships this rendering; phase 2 only adds the nicer one |
| D33 | **Two build phases, each shippable:** (1) format, kinds, takes, pick, retake, server plan, split-cell TOGETHER; (2) cutout, backgrounds, style UI | Phase 1 carries all server and protocol risk; phase 2 is client-only |

## 3. The shared plan (`src/shared/plan.ts`, new)

Pure types, a table, validators and a reducer, imported by the Worker and the client (so the rules are unit-testable without a Durable Object).

```ts
type TemplateId = 'strip4' | 'grid4' | 'duo2' | 'polaroid'   // cells: 4, 4, 2, 1
type CellKind = 'a' | 'b' | 'both'
type Stage = 'format' | 'shoot' | 'pick' | 'done'
interface Plan {
  v: number                    // bumped on every accepted change
  stage: Stage
  template: TemplateId | null
  kinds: CellKind[]            // length cellsOf(template); [] while template is null
  cell: number                 // the cell being shot or picked
  takes: number[][]            // per cell: rounds that both people hold complete photos for
  kept: Array<number | null>   // per cell: the chosen round
}
type PlanAction =
  | { k: 'template'; template: TemplateId }
  | { k: 'kind'; cell: number; kind: CellKind }
  | { k: 'keep'; round: number }       // for the current cell
  | { k: 'more' }
  | { k: 'retake'; cell: number }
  | { k: 'reset' }
```

**Stage machine** (`MIN_TAKES = 2`, `MAX_TAKES = 3` in `constants.ts`):

| From | Trigger | To |
|---|---|---|
| `format` | both ready, template chosen | `shoot`, cell 0; the first round is scheduled |
| `shoot` | a round completes and `takes[cell].length ≥ MIN_TAKES` | `pick`; `kept[cell]` defaults to that round |
| `shoot` | a round completes with fewer takes | stays `shoot` (a further ready starts the next take) |
| `pick` | `keep{round}` with `round ∈ takes[cell]` | stays `pick`, selection changes |
| `pick` | `more`, only if `takes[cell].length < MAX_TAKES` | `shoot`, same cell |
| `pick` | both ready | `shoot` on the first cell with `kept === null`; `done` if none |
| `done` | `retake{cell}` | `shoot` on that cell; `takes[cell] = []`, `kept[cell] = null` |
| any | `reset` | `format`, template and kinds kept, takes and kept cleared |

Rules the server enforces:

- Plan actions are accepted only when `phase === 'ready'`; `reset` also when `phase === 'waiting'` (a person alone after a reload must be able to leave a dead session). Never during a round in flight — no race with a capture.
- `template` and `kind` are valid only in `format`. A new template sets all kinds to `both`.
- Every accepted action bumps `v` **and clears both ready flags**, so a person can never be committed by a "ready" they pressed before the other changed the plan.
- `ready` means different things by stage: `format`/`shoot` → schedule a round (as today; refused while `template` is null); `pick` → advance; `done` → ignored.
- When both `photo-complete` arrive for the in-flight round, the server appends that round to `takes[cell]` — so a take exists only if **both** devices hold both photos. A round that times out or is cancelled records nothing.
- Stored record gains `plan`. It is additive: a room persisted before this change gets `defaultPlan()` on load.

## 4. Protocol (`src/shared/protocol.ts`)

- `ClientMessage` gains `{ type: 'plan'; action: PlanAction }`, parsed with the same style as today: key whitelists, enum membership, integer bounds (`cell` 0–3, `round` as `isRound`), unknown keys rejected, size inside `MAX_WS_FRAME_BYTES`.
- `RoomState` gains `plan: Plan`. There is no separate "plan" server message: every change already goes out as a `room-state`.
- No new close codes or error codes: a rejected action re-sends the caller's `room-state`, which is how `ready` is already refused (§5 of the base spec).
- The per-socket token bucket already covers plan spam.

## 5. Client structure

- `lib/rounds.ts` → **`lib/takes.ts`**: a store `Map<round, { a, b }>` built from `mergePhoto`/`completeRound` (kept as they are), pruned to the rounds the plan references. `stripBlobs`, `pushRound(keep=2)` go away.
- `lib/photo.ts`: `StripLayout` → `TemplateId`; `layoutStrip(template)` reads a `{cols, rows}` table. Geometry for `duo2`/`grid4` is unchanged (existing tests follow the rename).
- `lib/strip.ts`: `renderStrip(cells, template, meta)` where each cell is `{ kind, a?, b?, background?, cutouts? }`. `drawCell` draws the cell content onto its scratch tile **then** filters it, as it does now, so the filter never touches paper or frame. Tilt seed per cell: `${code}:${cell}:${keptRound}`, deterministic on both devices and new after a retake.
- `screens/Stage.tsx` stays the persistent screen for `format`/`shoot`/`pick` so the `<video>` element that capture reads is always mounted. Its lower panel switches on `plan.stage`:
  - **`FormatPanel`**: four template cards (mini-diagrams, like the reference), then one segmented control per cell (USER 1 · USER 2 · TOGETHER), built from `BrutalRadioGroup`, so keyboard and screen readers work. Shows "Either of you can choose."
  - **shoot panel**: the existing ready box, headed "CELL 2 OF 4 · TAKE 1".
  - **`PickPanel`**: the takes as thumbnails (a TOGETHER take shows both people side by side); tap = `keep`; buttons "ONE MORE TAKE" and "KEEP THIS ONE"; the two ready badges as today.
- **`components/Steps.tsx`**: FORMAT · SHOOT · PICK · STYLE chips derived from `plan.stage` (`done` = STYLE). Square, flat, no motion.
- `screens/Result.tsx` becomes the **STYLE/DONE screen** (stage `done`): strip, background picker (phase 2), filter, file type, download, share, and a **cell row** — one thumbnail + "RETAKE" per cell, behind a `BrutalModal` confirm ("THIS REPLACES CELL 2"). The layout radio is removed. Retake needs both people present, as today's `canRetake`.
- `Booth.tsx` wiring: `onMessage` stays; a `sendPlan(action)` helper over `room.send`; the photo store replaces `rounds`. `beginRound`, the scheduler and the exchange guards are untouched.
- **Never hide a finished strip** (final-review lesson I4, still binding): the STYLE/DONE screen does not disappear when the plan changes underneath it. If the partner `reset`s, a banner says "THEY STARTED OVER. SAVE YOUR STRIP." with a NEW STRIP button that adopts the new plan.
- **Reload mid-session** still loses that person's photos (base spec §13). If the plan references rounds this tab does not hold, show "YOUR PHOTOS WERE LOST WHEN THIS PAGE RELOADED" with a START OVER button (`reset`). The partner keeps their screen as above.

## 6. Cutout and backgrounds (phase 2)

- **`lib/segment.ts`**: `loadSegmenter()` dynamic-imports `@mediapipe/tasks-vision`, runs `FilesetResolver.forVisionTasks('/vendor/mediapipe-1.1.0/')` and creates an `ImageSegmenter` with the self-hosted model (`runningMode: 'IMAGE'`, confidence masks). One instance per tab, created on first use. Runs on the main thread: ≤ 8 inferences per strip and the screen shows "CUTTING YOU OUT…". `// ponytail:` main thread, move to a Worker if it janks on real phones.
- **`lib/cutout.ts`** (pure, unit-tested on synthetic masks): confidence mask → alpha with a smoothstep edge (about 0.35–0.65) so the edge is soft but not a halo; mask bounding box; scale and anchor.
- **Placing the two people in a TOGETHER cell:** USER 1 centred at 30 % of the cell width, USER 2 at 70 %, both anchored on their bounding box's bottom edge and scaled so the box is at most 100 % of the cell height and 55 % of its width, with overlap allowed. The numbers are a starting point to tune by eye on screenshots.
- Cutouts are cached per `round:slot` for the tab's life; they are computed from the **final pixels** (already mirrored if the preview was), so the mirror rule of D15 still holds.
- **Assets:** `scripts/vendor-mediapipe.mjs` copies the WASM from `node_modules` into `public/vendor/mediapipe-1.1.0/` on `postinstall`/`prebuild` (git-ignored — about 13 MB × variants must not live in git). The 249 KB model is **committed** at `public/vendor/models/selfie_segmenter.tflite`. `_headers` adds `Cache-Control: public, max-age=31536000, immutable` for `/vendor/*` (safe because the version is in the path).
- **CSP:** `script-src 'self' 'wasm-unsafe-eval'` — nothing else loosens, `connect-src 'self'` still holds because everything is self-hosted. A test guards that `_headers` has `wasm-unsafe-eval` and never `unsafe-eval`.
- **`lib/backgrounds.ts`**: `BACKGROUNDS: { id, label }[]` and `drawBackground(ctx, id, rect, rand)`, flat shapes only, seeded where random (confetti), palette colours only. `BackgroundPicker` shows round thumbnails rendered by the same function (like the reference's circles), with `none` first.

## 7. Server changes (`src/worker/BoothRoom.ts`)

Small and mostly in `shared/plan.ts`: `handle()` gains the `plan` message → `applyPlanAction`; the `ready` branch asks `onBothReady(plan)` what to do (schedule vs advance vs ignore); the `photo-complete` branch calls `recordTake(plan, round)` when the round completes; `defaultPlan()` at `create()` and on load. `stateFor()` adds the plan. The alarm, idle expiry and exchange-timeout paths are unchanged.

## 8. Security and privacy

- New input surface: one WebSocket message, strictly validated (§4); server stores only enum ids and integers, no personal data, no photos.
- Photos, cutouts and the model all stay in the browser; the privacy copy gains one line: "Cutouts are made on your device." No third-party requests: WASM and model are same-origin.
- A partner can `reset` or `retake` for both — acceptable inside a private two-person room the other person invited you to; the never-hide-the-strip rule (§5) bounds the damage.
- `'wasm-unsafe-eval'` is the one CSP loosening; it allows compiling WebAssembly, not `eval()` of strings.

## 9. Accessibility

Template cards are a radio group; each cell's kind is a labelled radio group; take thumbnails are buttons with `aria-pressed` and a text label ("Take 2, kept"); the stepper is an ordered list with `aria-current="step"`; status changes ("CUTTING YOU OUT…", "THEY STARTED OVER") use `role="status"`. Reduced motion needs nothing new (no new animation).

## 10. Testing and what can and cannot be verified here

- **Unit (`unit` project):** `plan.ts` reducer exhaustively — every stage guard, defaults, `MIN`/`MAX` takes, advance to the next unkept cell, retake, reset, bounds; protocol validators (unknown keys, bad enums, out-of-range cell/round); geometry for all four templates; `renderStrip` with each cell kind; `takes.ts` pruning; backgrounds drawn deterministically; cutout maths on synthetic masks.
- **Worker (`worker` project):** `BoothRoom` plan flow — `ready` semantics per stage, take recorded only on *both* `photo-complete`, ready cleared on every plan change, refused during a round and when the template is null, `reset` while alone, snapshot after reconnect includes the plan, a pre-existing record gets a default plan.
- **E2E (Playwright, two real browser contexts, fake camera):** pick `duo2` with kinds `[a, both]`; shoot 2 takes per cell; pick; reach STYLE; retake one cell; download and check the strip's pixel dimensions and that the retaken cell changed. Existing specs (`capture`, `photos`, `rounds`) are reworked for the new flow behind one shared helper.
- **Phase 2 e2e:** choose a background → the TOGETHER cell differs from `none` and the corner pixels equal the background colour. The Chromium fake camera is a test pattern, not a person, so this proves the pipeline runs, **not** that the cutout is good.
- **Cannot be verified here:** cutout quality on real people, hair and lighting; speed and heat on real phones; the 13 MB load on mobile data; MediaPipe under the deployed CSP (`vite dev` does not serve `_headers`) — all go on the README device checklist. Two facts to verify when phase 2 starts: the selfie model's licence terms, and that a 13 MB asset is within Cloudflare's per-asset limit (believed 25 MiB; unverified).

## 11. Build phases and gates

| Phase | Contents | Gate |
|---|---|---|
| **1 — Format & takes** | `shared/plan.ts` + tests; protocol; `BoothRoom` plan flow; `takes.ts`; template geometry; `renderStrip` by cell kind (split-cell TOGETHER); `Steps`, `FormatPanel`, shoot/`PickPanel`, STYLE/DONE with per-cell retake; e2e rework | typecheck, lint, full unit + worker suite, e2e green; deployable on its own |
| **2 — Cutout & style** | vendor script and assets; CSP; `segment.ts`, `cutout.ts`, `backgrounds.ts`, `BackgroundPicker`; wiring and fallback; README device checklist rows | same, plus the two verification facts in §10 |

## 12. Open assumptions (shout if wrong)

1. **`horizontal` 2×1 is dropped** (D24). One table row brings it back.
2. **Both people must press ready** to start shooting and to move on from a pick; **either** can change the format, kinds, kept take, "one more" and retake.
3. **Style is per person** (D29): backgrounds and filters can differ between your two downloads.
4. **One background for all TOGETHER cells**, not one per cell.
5. **Default background is `none`** (side by side), so the 13 MB cutout tool only downloads on request.
6. **Face filters (ears, crowns) and live-camera backgrounds are out of scope**, as agreed.
7. **Takes are explicit:** each take needs both people to press ready. A 4-cut is 8–12 countdowns, roughly 3–4 minutes. If that feels long on a real device, auto-ready for takes after the first is the obvious follow-up; it is not in this spec.
8. **A reload loses that person's photos** (existing limitation) and the START OVER path is the recovery.
