# Wizard Flow — Design Spec

Date: 2026-10-08 · Status: **draft for review** · Builds on `2026-10-07-photobooth-design.md` (D1–D23) and `2026-10-08-format-and-style-design.md` (D24–D33). Decisions here continue as **D34 onward**.
Source: the owner's request ("the user flow is not user friendly enough; make it friendly like getangie.com/photobooth"), a walk through that site's first screens, four screenshots of its later steps (Frame → Shoot → Pick → Style → Done), our own flow captured at 390×844, and the owner's answers to three questions (§2).

---

## 1. Problem and goal

On a phone our flow loses people:
- **Camera first.** Right after creating a booth the first screen is a dead-end "TURN ON CAMERA", before the person has even seen their room code.
- **Two live video frames before any choice.** On the format screen THEM and YOU fill two screens of height; the format cards are below the fold.
- **One READY button does two jobs** ("I like this format" and "start shooting") and, being `sticky`, covers the format cards and the per-cell options.
- **Too many decisions on one screen:** four size cards plus up to four who's-in-the-frame radio groups.
- **Long shooting:** each of up to four frames needs 2–3 separate ready presses, then a separate pick per frame (8–12 presses for a 4-cut).
- **Heavy copy and styling:** all-caps, tilted labels, borders everywhere.

**Goal:** a calm step-by-step wizard — one decision per screen, one obvious button, the camera asked for late, plain friendly wording — with the **same Neo-Brutalist identity** (owner's choice A): bold palette, hard shadows, 3 px borders, but calmer density.

**Success =** two people on phones can go from "Start a room" to a downloaded strip using: share a code, tap a size, tap Next, allow the camera, press **I'm ready once**, tap favourites, tap Next, tap Next, tap Download — and never see a screen that asks them two things.

## 2. Decisions

| # | Decision | Why |
|---|---|---|
| D34 | **The session is a wizard of single-decision screens** with a stepper **Frame · Shoot · Pick · Style · Done** (the same five steps as the reference). Landing and the room-code screen come before step 1. Completed steps are tappable to go back. | Owner request; the reference's structure |
| D35 | **Look: same Neo-Brutalist identity, calmer.** Sentence case, no tilted labels, more air, one accent per screen, large headings, one primary button pinned to the bottom of the screen on phones. The style-rule tests keep guarding palette, radii, shadows. | Owner chose A over restyling to the reference's look |
| D36 | **The camera is asked for at the Shoot step**, after one friendly sentence of privacy copy. The room-code, Frame, Pick, Style and Done screens need no camera. The room socket and clock sync start as soon as the room opens; the WebRTC call is built only once **both** people's cameras are on (a per-person `camera` flag in the room state). | The first thing people should see is their code; also nothing on Frame/Pick/Style needs live video |
| D37 | **Frame is one decision:** pick a size (four cards, "Tap one. Either of you can choose."), then **Next**. Every frame defaults to "Both". **Next and Back are unilateral and reversible** (either person's tap moves both screens) at every step except while a shot sequence is running. | Owner Q3; keeps the first screen trivial. An unseen step change is cheap to undo |
| D38 | **Shooting is one "I'm ready", then an automatic sequence** (owner chose A, supersedes D26 per-cell takes). Both press ready once; the Durable Object then schedules shot after shot itself (approach X): the first with today's 4.5 s lead, each next one **3 s** after the previous shot finished; a shot that fails to complete in **12 s** is skipped. Target shots = **frames + 2** (Polaroid 3, 2-cut 4, 4-cut and 2×2 6). "Shoot more" adds **3** spare shots; at most **12** shots per session. When the target is reached the step moves to Pick by itself. | Far fewer taps; reuses the existing server-timed round, clock sync and photo exchange |
| D39 | **Pick: choose your favourites.** All shots appear as thumbnails; the frame slots are pre-filled with the first shots. Tap a shot, then a slot, to fill it (a shot already used elsewhere **swaps** with that slot). Each slot has **Both / Just you / Just them** (moves D25's per-cell kinds here — owner Q3 A; "you/them" are relative per screen, stored as USER 1/USER 2 = slot a/b). Next needs every slot filled. Replaces D28 (retake a cell): to redo a frame, pick another shot or "Shoot more". | Decide who is in a frame when you can see the photos |
| D40 | **Style** (background, filter) is still **per person** (D29) but its state is lifted so it survives step changes. **Done** shows the final strip with Download, Share, file type and **Make another** (back to Frame with the same size). | Keeps D29, D30–D32 (cutouts, backgrounds, fallback) unchanged |
| D41 | **READY exists only at Shoot.** The "keep this one" ready presses of D26 are gone; every other step change is a plain Next/Back. | One meaning per button |
| D42 | **Out of scope:** booth themes (Classic/Birthday/Vintage/Meme), "Just me" and "Group of 4" modes, live scene backgrounds, face filters, a Stop button during a sequence (leaving the booth, or **Start over**, cancels). | Not requested; owner accepted the defaults |
| D43 | **Copy is sentence case and plain** (list in §8). The brief's verbatim **error screens** (§31) and **privacy note** (§32) stay exactly as they are; the landing headline stays; the landing buttons become "Start a room" and "Join a room". | Owner request supersedes the brief's all-caps microcopy for the booth screens only |

## 3. The flow

```
Landing ──Start a room──▶ Room (code, no camera) ──partner arrives──▶ Frame ──Next──▶ Shoot ──ready, ready──▶ [auto sequence] ──▶ Pick ──Next──▶ Style ──Next──▶ Done
        └─Join a room (code)───────────────────────────────────────▶ Frame            (allow camera here)                                    ▲ Make another ─▶ Frame
```

| Screen | Content | Primary action |
|---|---|---|
| **Room** | "Send this code to your partner" · "They type it in, or open your link." · six big code tiles · Copy link · Share (Web Share where present) · QR · "Waiting for your partner…" | none; moves on by itself |
| **Frame** | "Pick a size" · four cards with a drawn preview · "Tap one. Either of you can choose." | **Next** (disabled until a size is chosen) |
| **Shoot** | first: "Allow your camera" + one privacy line; then YOU and THEM live frames (side by side when wide, compact stacked on a phone), who is ready, the sequence progress "Shot 2 of 6" and the countdown | **I'm ready** (needs both cameras on, call connected, clock synced) |
| **Pick** | thumbnails of every shot · the frame slots · Both / Just you / Just them per slot · "Shoot more" | **Next** (all slots filled) |
| **Style** | live strip · background swatches (only if a frame is "Both") · filter | **Next** |
| **Done** | final strip · file type · Download · Share · Make another | **Download** |

The stepper is at the top of every step screen. **Back** is a quiet link, never the primary button. Step screens move keyboard focus to their heading when they appear, and announce the step to screen readers (`role="status"`).

## 4. The shared plan (`src/shared/plan.ts`, reworked)

```ts
type Step = 'frame' | 'shoot' | 'pick' | 'style' | 'done'
interface Slot { shot: number | null; kind: CellKind }        // shot = round number; kind = 'a' | 'b' | 'both'
interface Plan {
  v: number                  // bumped on every accepted change
  step: Step
  template: TemplateId | null
  slots: Slot[]              // one per frame; [] while there is no template
  shots: number[]            // rounds both people hold complete photos for, in the order taken
  target: number             // how many shots the current sequence aims for
  running: boolean           // a sequence is in progress; the server keeps scheduling
  misses: number             // shots skipped in the running sequence
}
type PlanAction =
  | { k: 'template'; template: TemplateId }       // frame step only
  | { k: 'go'; to: Step }                          // Next / Back / stepper tap (rules below)
  | { k: 'fill'; slot: number; shot: number }      // pick step; swaps if the shot is used elsewhere
  | { k: 'kind'; slot: number; kind: CellKind }    // pick step
  | { k: 'reset' }                                 // Make another / Start over, from anywhere
```
The `template` action rebuilds `slots` (every `kind` "both", pre-filled with the first shots). `go` rules: `frame→shoot` needs a template; `shoot→pick` needs `shots.length ≥ slots.length` and no running sequence; `pick→style` needs every slot filled; `style→done` free; **backwards moves are always allowed** except while `running`. `reset` keeps the template, clears shots and slots' shots, returns to `frame`, and is also how a person cancels a running sequence.

Server-driven transitions (not client actions): `ready` from both at `shoot` starts a sequence (`running`, `target = shots.length < slots.length + 2 ? slots.length + 2 : shots.length + 3`, capped at 12); each completed shot is appended to `shots` and fills the first empty slot; at the target, or after `3` misses, the sequence ends: `running = false` and the step becomes `pick` (or stays `shoot` with a "that didn't work, go again" message if there are fewer shots than frames).

## 5. Server (`BoothRoom`) and protocol

- `PState` gains `camera: boolean`; `ClientMessage` gains `{ type: 'camera'; on: boolean }`. The flag clears when a person's last socket goes away. `ready` is accepted only at `shoot`, with both cameras on, and not while `running`.
- **Sequencing (approach X).** `schedule()` is called for the first shot as today (`CAPTURE_LEAD_MS`). When both `photo-complete` arrive, the shot is recorded and, if the sequence continues, the next round is scheduled **immediately** with a 3 s lead (`BURST_LEAD_MS`); when the exchange alarm fires for a round that never completed (`EXCHANGE_TIMEOUT_MS`, lowered from 30 s to **12 s**), `misses` increments and the sequence continues or ends as above. A partner leaving cancels the round and sets `running = false`; recorded shots are kept and "I'm ready" resumes towards the same target.
- Plan actions are accepted only in `phase === 'ready'` and never while `running`, except `reset` (any phase except `capture`, as today).
- **Compatibility:** a persisted room whose plan lacks `slots` gets `defaultPlan()` on first read (the rule already used for plan-less rooms).
- All new frames are validated with the same strict key whitelists and bounded integers; `go.to` is checked against the `Step` list.

## 6. Client structure

- `Booth.tsx` keeps what must survive a step change (room socket, clock sync, WebRTC, the photo store, capture, the finished-strip snapshot, per-person style state) and renders **one screen per `plan.step`** inside a shared **`WizardShell`** (header, stepper, content, pinned bottom action bar).
- New screens: `RoomScreen`, `FrameScreen`, `ShootScreen` (with the inline camera permission), `PickScreen`, `StyleScreen`, `DoneScreen`. `Lobby`, `Stage`, `FormatPanel`, `PickPanel`, `ReadyCard` and the old `Result` are removed; their reusable parts (`TemplateDiagram`, `PhotoThumb`, `BackgroundPicker`, `CameraFrame`, `Countdown`) are kept.
- The room socket no longer waits for the camera; `useWebRTC` builds the call when both `camera` flags are on (slot a offers). A person whose browser still holds a camera stream re-announces `camera: true` after every reconnect snapshot.
- **Protection of the finished strip and "photos lost on reload" carry over unchanged in behaviour** (the snapshot now covers the Style and Done steps; a plan that references shots this tab does not hold shows the same "Your photos were lost when this page reloaded" card with Start over).
- `takes.ts` is reshaped around `shots` and `slots` (store keyed by round, prune to rounds referenced by `shots`/`slots` with the existing `highestSeen` rule, `missingShots`, `finishedOf` from slots).

## 7. Look

Tokens and the palette are unchanged. New screens use: `text-3xl/4xl font-black` headings in sentence case, `text-base` body text (no `uppercase`), one coloured card per screen at most, no rotation classes, a bottom action bar (`sticky bottom-0`, safe-area padding, min height 56 px) with exactly one primary button, an unobtrusive text "Back". `style-rules.test.ts` is unchanged and must stay green.

## 8. Copy

Landing: **Start a room**, **Join a room** · Room: **Send this code to your partner**, **They type it in, or open your link.**, **Copy link**, **Share**, **Waiting for your partner…**, **Your partner is here!** · Frame: **Pick a size**, **Tap one. Either of you can choose.**, **Next**, **Back** · Shoot: **Allow your camera** ("Your camera stays in your browser. Photos are made on your device."), **I'm ready**, **Waiting for your partner…**, **Get ready…**, **Shot 2 of 6**, **That didn't work. Go again.** · Pick: **Pick your favorites**, **Tap a shot, then a frame.**, **Both**, **Just you**, **Just them**, **Shoot more**, **Next** · Style: **Pick a look**, **Next** · Done: **All done!**, **Download**, **Share**, **Make another**.

## 9. Security, privacy, accessibility

- One new WebSocket message (`camera`) and a changed plan-action shape, both strictly validated; the server still stores only enum ids and integers; photos never leave the browsers.
- The camera prompt is preceded by the privacy sentence; no camera is requested before the Shoot step.
- Step screens use real headings, native radios/buttons, `aria-current="step"` in the stepper, focus moved to the new heading on every step change, `role="status"` for progress ("Shot 2 of 6"); reduced-motion needs nothing new. The a11y e2e (axe) runs on every step screen.

## 10. Testing and what can and cannot be verified here

- **Unit:** the plan reducer (every transition, `go` rules, `fill` swap, `reset`, the sequence target rule), `takes.ts` over shots/slots, validators for the new frames.
- **Worker:** sequencing in `BoothRoom` — first shot, automatic next shot, skipped failed shot, miss cap, end → `pick`, partner leaving mid-sequence and resuming, camera flag set/cleared, `ready` refused without both cameras, an old-shape plan reset to default.
- **E2E (two real browsers, fake camera):** the whole wizard from landing to Download; camera not requested before Shoot; Next/Back sync; the sequence runs after one ready each; Pick swap and Both/Just you/Just them; style per person; Make another; the existing resilience specs (missed round, call dies, reload, partner leaves) reworked. The old format/takes/style e2e specs are replaced. Fewer ready presses make the suite faster.
- **Cannot be verified here:** how it *feels* on real phones (tap targets, the bottom bar with a mobile browser's URL bar, a notch), the sequence rhythm on real networks, and whether people find the copy friendly — README device checklist rows are added.

## 11. Build phases

1. **Model and server:** `plan.ts`, `protocol.ts`, `BoothRoom` sequencing and camera flag, `takes.ts`, with unit and worker tests. Gate: `npm run check` green.
2. **Wizard and screens:** `WizardShell`, Room/Frame/Shoot/Pick/Style/Done, camera-late wiring, copy and look; remove the old screens; rework every e2e spec. Gate: `npm run check`, `npm run build`, the full e2e suite.
Phase 1 alone leaves the client unable to run end-to-end (the plan shape changed), so the app is only deployable after phase 2.

## 12. Open assumptions (shout if wrong)

1. Next/Back/stepper taps by either person move both screens (D37); there is no "are you sure" and no consent step.
2. Targets are frames + 2 shots and "Shoot more" adds 3, capped at 12 shots (D38).
3. A running sequence cannot be stopped from the Shoot screen; Start over (reset) cancels it (D42).
4. The landing buttons change to "Start a room" / "Join a room" while the headline stays (D43).
5. The room code stays six characters (D2) rather than the reference's five.
6. "Just you / Just them" are shown relative to each screen but stored as USER 1 / USER 2 (slot a / slot b).
