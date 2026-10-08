# Format & Style Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Read this master file first, then the phase file that holds your task.** Each phase file is self-contained for its tasks and ends in a gate that must pass before the next phase starts.

**Goal:** Turn the booth into a guided, shared session — pick a format (4-cut, 2×2, 2-cut, Polaroid) and, per cell, whose picture goes there (USER 1, USER 2, TOGETHER); shoot 2–3 takes per cell and keep the best; retake any single cell; and make TOGETHER cells a cutout of both people on a chosen background.

**Architecture:** A small shared `Plan` (template, per-cell kinds, stage, take rounds, kept round) lives in the existing `BoothRoom` Durable Object and rides inside every `room-state`; clients send validated *actions*. Photos stay in the browsers. The strip renderer becomes cell-driven. Phase 2 adds a lazily loaded, self-hosted MediaPipe selfie segmenter and procedural backgrounds, entirely client-side.

**Tech Stack:** unchanged (React 19 · TypeScript ~6.0 · Vite 8 + `@cloudflare/vite-plugin` · Tailwind v4 · Workers/Durable Objects · Vitest 4 · Playwright) plus `@mediapipe/tasks-vision` 1.1.0 in phase 2.

**Spec:** `docs/superpowers/specs/2026-10-08-format-and-style-design.md` (decisions D24–D33 are binding; the base spec `2026-10-07-photobooth-design.md` D1–D23 still applies except D13/D14, which D26/D28 supersede. Where this plan and the spec disagree, stop and flag it).

## Phase files

| Phase | File | Tasks | Gate |
|---|---|---|---|
| 1 Format & takes | `2026-10-08-format-and-style-phase-1-format-and-takes.md` | 1–7 | `npm run check` + `npm run build` green; full e2e green (reworked specs + `format`, `takes`, `style`); deployable on its own |
| 2 Cutout & style | `2026-10-08-format-and-style-phase-2-cutout-and-style.md` | 8–13 | same, plus `segment` and `background` e2e, CSP/vendor guards, README device checklist rows |

## Global Constraints

Every task's requirements implicitly include this section. Values are copied from the spec and the existing code.

**Architecture rules (unchanged from the base spec)**
- Video never touches the Worker or the Durable Object. **Photos, cutouts and the model never touch the server.** The DO stores only enum ids and integers (the plan), never photos, names or IPs.
- No accounts, no analytics, no R2, no audio. Product code never fakes the camera, WebRTC, WebSocket or timestamps.
- Photo exchange uses only the DataChannel (D11). Capture scheduling stays server-owned: no client-triggered schedule message (D3). No ICE restart (D17).
- Preview = result (D15): photos are final pixels (mirrored when the preview was mirrored); the strip, the pick thumbnails and the background swatches are drawn so that what you see is what you download.

**Versions / dependencies**
- Same ranges as before (`typescript ~6.0.3`, `vitest ^4.1`, `vite ^8`, …). npm only. No state library, no zod, no CSS-in-JS, no UI kit. Hand-written validators.
- Phase 2 adds exactly one dependency: `@mediapipe/tasks-vision` pinned to **`1.1.0`** (Apache-2.0; `npm i --save-exact`). Its version appears in the vendored asset path, so it must stay pinned.

**Constants** (live in `src/shared/constants.ts` unless noted; nothing hard-codes them elsewhere)
- `MIN_TAKES = 2` · `MAX_TAKES = 3` · `MAX_CELLS = 4`.
- Templates (table in `src/shared/plan.ts`, one source for server cell counts and client geometry): `strip4` 1×4 · `grid4` 2×2 · `duo2` 1×2 · `polaroid` 1×1. Cell kinds: `a` (USER 1 = slot `a`, the creator) · `b` (USER 2) · `both` (TOGETHER). Stages: `format` · `shoot` · `pick` · `done`.
- Strip geometry is unchanged: `CELL_W 960`, `CELL_H 720` (4:3), `STRIP_PAD 48`, `STRIP_GAP 48`, `STRIP_FOOTER_H 168`. Resulting sizes: `duo2` 1056×1800 · `grid4` 2064×1800 · `polaroid` 1056×1032 · `strip4` 1056×3336.
- Phase 2: model `public/vendor/models/selfie_segmenter.tflite` (**249,537 bytes**, float16); vendored WASM at `/vendor/mediapipe-1.1.0/`; segmentation timeout **15 000 ms**; mask edge = smoothstep **0.35 → 0.65**; people centred at **30 % / 70 %** of the cell width, each box ≤ **100 %** of the cell height and ≤ **55 %** of its width; default background id `none`.

**Look and copy**
- Neo-Brutalist rules from the base plan hold (borders 3–4 px, radius ≤ 8 px, hard shadows only, no blur, no gradients, palette tokens). **`src/client/style-rules.test.ts` greps every client source file (comments included) for `gradient` (any case), `blur(`/`blur-`, soft `shadow-*` and `rounded-xl/2xl/3xl/full`. Never write those words or types (e.g. `CanvasGradient`) in client code, not even in a comment.** Use `Pick<CanvasRenderingContext2D, …>` instead of naming the fill-style union.
- Copy (all caps, as the rest of the app): stage chips `FORMAT` `SHOOT` `PICK` `STYLE`; `PICK A FORMAT`; `EITHER OF YOU CAN CHOOSE.`; `USER 1` / `USER 2` / `TOGETHER` (own side appends ` (YOU)`); `CELL 2 OF 4 · TAKE 1`; `ONE MORE TAKE`; `KEEP THIS ONE` / `KEPT ✓`; `CHANGE FORMAT`; `NOT HAPPY WITH A CELL?`; `RETAKE 2`; `THIS REPLACES CELL 2.` with buttons `KEEP IT` / `YES, RETAKE`; `THEY STARTED OVER. SAVE YOUR STRIP.` + `NEW STRIP`; `THEY'RE RETAKING A CELL.` + `JOIN THEM`; `YOUR PHOTOS WERE LOST WHEN THIS PAGE RELOADED` + `START OVER`; phase 2: `CUTTING YOU OUT…`, `COULDN'T CUT YOU OUT. SHOWING SIDE BY SIDE.`, `CUTOUTS ARE MADE ON YOUR DEVICE.`. The brief's own copy (hero, privacy note, errors) stays verbatim — do not edit `PrivacyNote`.
- Accessibility: radios are native inputs; take thumbnails are buttons with `aria-pressed`; the stepper is an `<ol>` with `aria-current="step"`; status changes use `role="status"`.

**Process**
- TDD for logic: failing test → run → minimal code → pass. Watch every test fail first.
- **Between Task 2 and Task 7 the old e2e specs (`capture`, `photos`, `rounds`, `a11y`) are expected to be red** — the server now needs a chosen template before READY means anything. Typecheck, lint, unit and worker suites must be green after *every* task. Task 7 reworks the e2e specs and closes the gate.
- Commit after each implemented task (more often at natural checkpoints). **Conventional Commits** (`feat fix docs refactor test chore ci perf`), lowercase imperative summary, no trailing period. **No `Co-Authored-By` or "Generated with" trailers (owner's standing rule). Never push.** Stage explicit paths, not `git add -A`.
- Work on branch `feat/format-and-style` (already created off `main`). Every code step shows the code; if reality (an API name, a tool version) forces a different shape, change it, make the tests pass, and say so in the commit body.
- `eslint-plugin-react-hooks` is limited to `rules-of-hooks` and `exhaustive-deps` here. Effects may call `setState`, but derive values during render when you can.

## Review Focus

Five inputs/conditions the spec implies but would not otherwise be exercised. Each has a test in the task named.

1. **The plan changes after a person already pressed READY, or while a round is in flight** → both ready flags are cleared on every accepted plan change, READY is ignored until a template exists, and `reset`/`retake`/`kind` are refused mid-capture. Nobody is ever committed to a plan they did not see. *Tests: Task 2.*
2. **A person reloads mid-session** → the server still holds the plan but this tab holds none of the photos it points at: say so ("YOUR PHOTOS WERE LOST…"), offer START OVER, and never render a broken or blank strip. The partner's finished strip must not vanish when the other person starts over. *Tests: Task 3 (`missingRounds`), Task 6 (e2e).*
3. **A take's photo exchange fails or times out on one side** → the server records no take, the cell stays in `shoot` (still on "TAKE 1", CHANGE FORMAT still offered), and no phantom take appears on either screen. *Tests: Task 2 (alarm path), Task 7 (`rounds.spec` missed-round recovery).*
4. **Both people tap different takes at the same instant, or a client sends a `keep` for a round that is not a take of this cell** → invalid rounds are refused, valid ones are last-write-wins, and both screens converge on the same plan. *Tests: Tasks 1 and 2.*
5. **The cutout model cannot load or run** (offline, blocked asset, slow phone, WASM unsupported) → TOGETHER cells fall back to the side-by-side rendering with a visible notice, and DOWNLOAD keeps working. *Test: Task 12 (e2e blocks the vendor assets).*

Also covered inside their owning tasks: the plan survives a partner leaving and reclaiming their slot (Task 2); a persisted room from before this change gets a default plan (Task 2); an inverted segmentation mask is detected and flipped (Task 9); a sixth template card or a malformed `plan` frame is rejected (Tasks 1–2).

---

## File map

```
photobooth/
├─ scripts/vendor-mediapipe.mjs        (new, T10)  copies WASM from node_modules to public/vendor/, verifies the model
├─ public/
│  ├─ _headers                         (T10)  + 'wasm-unsafe-eval', + /vendor/* immutable cache
│  └─ vendor/models/selfie_segmenter.tflite   (new, T10, committed, 249 537 bytes)
│     vendor/mediapipe-1.1.0/*         (generated, git-ignored)
├─ src/shared/
│  ├─ constants.ts                     (T1)   + MIN_TAKES, MAX_TAKES, MAX_CELLS
│  ├─ plan.ts + plan.test.ts           (new, T1)  Plan types, TEMPLATES table, reducer, validators
│  └─ protocol.ts (+test)              (T2)   `plan` client message, RoomState.plan
├─ src/worker/
│  ├─ BoothRoom.ts (+test)             (T2)   owns the plan; ready/photo-complete drive it
│  └─ test-helpers.ts                  (T2)   lastState(), Peek.plan
├─ src/client/
│  ├─ lib/
│  │  ├─ photo.ts (+test)              (T3)   template geometry (StripLayout removed)
│  │  ├─ strip.ts (+test)              (T3, T8, T12) cell-driven renderStrip, cellPlacements, tilt per cell
│  │  ├─ takes.ts (+test)              (new, T3)  replaces rounds.ts: store, prune, missing, kept cells
│  │  ├─ labels.ts (+test)             (new, T4)  stage chips, template/kind labels
│  │  ├─ palette.ts (+test)            (new, T3)  canvas colours = CSS tokens
│  │  ├─ backgrounds.ts (+test)        (new, T8)  procedural scenes + drawBackground
│  │  ├─ cutout.ts (+test)             (new, T9)  pure mask maths + placement
│  │  ├─ vendor.ts                     (new, T10) asset URLs / version
│  │  └─ segment.ts (+test)            (new, T11) lazy MediaPipe loader, cutOut(blob)
│  ├─ hooks/  useStrip.ts (T3, T12) · useBlobUrl.ts (T5) · useCutouts.ts (new, T12)
│  ├─ components/  Steps · TemplateDiagram (T4) · PhotoThumb (T5) · BackgroundPicker (T12)
│  ├─ screens/  ReadyCard · FormatPanel (T4) · PickPanel (T5) · Stage (T4–T6) · Result (T3, T6, T12)
│  └─ pages/Booth.tsx                  (T3–T6) store + plan wiring, sendPlan, finished snapshot
├─ e2e/  helpers.ts (T4, T5) · format.spec (T4) · takes.spec (T5) · style.spec (T6) ·
│        reworked capture/photos/rounds/a11y (T7) · segment.spec (T11) · background.spec (T12)
└─ README.md                           (T7, T13)
```
