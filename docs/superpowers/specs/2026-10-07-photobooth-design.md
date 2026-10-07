# Two-Person Synchronized Photo Booth — Design Spec

Date: 2026-10-07 · Status: **draft for review** · Source: the 48-section brief supplied by the user (referred to below as "the brief").

This spec turns the brief into decisions. Where it follows the brief it says nothing; where it
departs from or fills a gap in the brief, the change is listed in §2 so it can be reviewed in one place.

---

## 1. What we are building

A web app where two people on separate devices open the same private room, see each other over
WebRTC, press "ready", watch a synchronized 3-2-1, and each browser captures its own camera at the
same server-defined instant. The two photos are exchanged peer-to-peer and composed into a
downloadable photo strip. Visual identity: Neo-Brutalist (brief §3–§7, §37–§39).

**Hard architecture rules (from the brief, unchanged):**

- Video travels browser↔browser over WebRTC. It never touches the Worker or the Durable Object.
- The Durable Object (DO) carries WebSocket signaling, ready state, clock sync and capture scheduling only.
- Photos are captured, filtered and composed locally. They never touch the server.
- No accounts. No stored personal data. Real camera, real WebRTC, real WebSocket, real timestamp — no fakes in product code.

**Success =** two browsers (and, by the owner's manual test, two phones on different networks) can
complete: create → join → camera → live video both ways → both ready → synchronized capture →
photo exchange → strip → download.

## 2. Deviations from, and additions to, the brief

| # | Brief says | Spec does | Why |
|---|---|---|---|
| D1 | `wrangler.toml`, DO migrations implied | `wrangler.jsonc` with the declarative **`exports`** field (`type: "durable-object"`, `storage: "sqlite"`) | Brief §42 demands current config. Wrangler docs (checked 2026-10-07): `migrations` is "legacy imperative"; `exports` is preferred for new Workers and the two are mutually exclusive. |
| D2 | Example code `A7K9` (4 chars) | **6-char** code, 31-symbol alphabet `ABCDEFGHJKMNPQRSTUVWXYZ23456789`, ≈29.7 bits, rejection-sampled from `crypto.getRandomValues` | Brief §33 wants strong IDs; 4 chars (~20 bits) lets someone brute-force a waiting room. UI shows it as `A7K 9XM`. Accepted by owner on 2026-10-07. |
| D3 | `schedule-capture` client message | **Removed.** Server schedules automatically when both participants are ready | Brief §14/§15 already say the countdown starts automatically on both-ready; a client-triggered schedule would be a second, redundant path. |
| D4 | `room-state` carries `BoothRoom` | Carries a `RoomState` DTO. `BoothRoom` is only the DO class | Name clash in the brief. |
| D5 | `photo-complete` has no fields | `{ type: "photo-complete"; round: number }` | Ignore stale completions from a previous round. |
| D6 | Added: `error` server message; close codes | See §6 | "Validate every message" needs a way to say no. |
| D7 | `src/types/index.ts` | `src/shared/` (protocol types, validators, constants, room-code) imported by both worker and client | Types alone aren't shared — validators and constants are too. |
| D8 | Pages: Home, CreateBooth, JoinBooth, Booth | Same four files. `CreateBooth` = "building your booth…"/failure screen that POSTs then redirects to `/b/:code`. The lobby (code, link, QR, waiting) is part of `Booth` | The lobby must keep the same WebSocket, camera and peer connection once the partner arrives; splitting it across routes would tear them down. |
| D9 | R2 optional | **Not used.** No R2 binding | Photos stay local (brief §22). README notes where it would plug in. |
| D10 | Audio unspecified | **No audio** (`getUserMedia({audio:false})`) | Nothing in the brief needs it; smaller permission prompt, no echo/feedback handling. |
| D11 | Photo exchange "DataChannel or client-side exchange" | DataChannel only, **no WebSocket/DO fallback** | Relaying photos through the DO would contradict the privacy copy (§13). If the DataChannel fails the user sees the WebRTC-failure screen. |
| D12 | Rate limiting "where appropriate" | Cloudflare Rate Limiting **binding** (per-IP, per route group) for HTTP + in-DO token bucket per socket | Binding is per-location and eventually consistent; Cloudflare's docs advise against IP keys. There is no better key for unauthenticated create/join/ice, so limits are generous and this is abuse mitigation, not accounting. |
| D13 | Grid = "A \| B / C \| D" | A *round* = one capture by both people = 2 photos. Grid unlocks after **2 rounds** | A grid needs 4 photos. |
| D15 | (not specified) | **Preview = result.** A frame's preview is mirrored exactly when the photo captured from it is mirrored, on *both* sides: your own frame and the THEM frame. Each client tells the other whether its camera is mirrored over the DataChannel (`cam` message, §8). Rule: `mirrored = trackSettings.facingMode !== "environment"` (front cameras and desktop webcams mirror; the rear camera does not) | Owner request 2026-10-07 ("make the preview same as result"). Each photo in the strip then shows its person exactly as they looked in the frame you watched. |
| D14 | RETAKE button | "RETAKE" = press ready again → a new round. Only the **last 2 rounds** are kept | Reuses the ready mechanism: zero new protocol messages, and neither person is yanked off the result screen by the other. |

## 3. Verified platform facts and pinned versions

Checked on 2026-10-07 against Cloudflare docs and npm. Re-run `npm view` at install time; versions are ranges.

- **TURN credentials:** `POST https://rtc.live.cloudflare.com/v1/turn/keys/$TURN_KEY_ID/credentials/generate-ice-servers`, header `Authorization: Bearer $TURN_KEY_API_TOKEN`, body `{"ttl": <seconds>}`, response `201 {"iceServers":[{urls:[stun…]},{urls:[turn…], username, credential}]}` — safe to hand to the browser.
- **DO WebSockets:** Hibernation API — `ctx.acceptWebSocket(ws)`, handlers `webSocketMessage / webSocketClose / webSocketError`, `ws.serializeAttachment()` (≤ 16 384 bytes), `ctx.getWebSockets()`. We need a custom pong carrying `serverTime`, so `setWebSocketAutoResponse` (static reply) cannot be used for clock sync.
- **Assets/SPA:** `"assets": { "directory": "./dist/client", "binding": "ASSETS", "not_found_handling": "single-page-application", "run_worker_first": ["/api/*"] }`. The exact `directory` is whatever `@cloudflare/vite-plugin` emits — confirm at scaffold time.
- **Rate limiting:** `"ratelimits": [{ "name", "namespace_id", "simple": { "limit", "period": 10 | 60 } }]`; `const { success } = await env.X.limit({ key })`.
- **Test plugin:** package `@cloudflare/vitest-plugin` (`cloudflareTest()` inside `defineConfig`), requires **Vitest ≥ 4.1 < 5**. Vitest 5.0.3 is the current release on npm and is *not* compatible — pin `^4.1`.
- **TypeScript:** pin `~6.0.3`. `typescript-eslint` peers `typescript <6.1.0`; TS 7.0.2 is on npm but unsupported by the linter.

| Package | Range | Note |
|---|---|---|
| vite | ^8 | `@cloudflare/vite-plugin` peers `^6.1 \|\| ^7 \|\| ^8` |
| @cloudflare/vite-plugin / wrangler | ^1.63 / ^4.148 | plugin requires wrangler ≥ 4.148 |
| react, react-dom | ^19.2.7 | react-router 8 peer floor |
| react-router | ^8 | library (declarative) mode; Node ≥ 22.22 (have 24.14) |
| tailwindcss, @tailwindcss/vite | ^4.3 | tokens via `@theme` |
| typescript | ~6.0.3 | see above |
| eslint, typescript-eslint, eslint-plugin-react-hooks | ^10, ^8.71, ^7 | |
| vitest, @cloudflare/vitest-plugin | ^4.1, ^1.3 | |
| @playwright/test | ^1.63 | Chromium only for automation |
| qrcode, @types/qrcode | ^1.5 | brief §29: established library |
| @fontsource-variable/space-grotesk | ^5 | self-hosted; no third-party font request |

No state library, no zod, no CSS-in-JS, no UI kit. Hand-written message validators (≈8 shapes).

## 4. Architecture

```
Browser A ──┐  HTTPS/WSS            ┌── Worker (src/worker/index.ts)
            ├────────────────────►──┤     POST /api/rooms        create
Browser B ──┘                       │     GET  /api/rooms/:code  exists/full?
   ▲   ▲                            │     GET  /api/rooms/:code/ws  upgrade → DO
   │   └── WebRTC (video + photo ──►│     GET  /api/ice?room=    STUN (+TURN)
   │       DataChannel), P2P        │     *    → ASSETS (SPA)
   └────────────────────────────────┘          │
                                               ▼
                                     Durable Object BoothRoom  (one per code)
                                     idFromName(code) · SQLite-backed · hibernating
```

**Bindings / config:** `BOOTH_ROOM` (DO, via `exports`), `ASSETS`, `RATE_LIMIT` (ratelimits), var `TURN_KEY_ID`, secret `TURN_KEY_API_TOKEN` (local: `.dev.vars`). TURN is optional — unset ⇒ STUN-only.

**Worker routes**

| Route | Behaviour |
|---|---|
| `POST /api/rooms` | Rate-limit. Generate code; `stub.create()` returns false on collision → retry (≤5). `201 {code}` |
| `GET /api/rooms/:code` | Rate-limit. Validate format → `400`; DO `status()` → `404` if never created / expired; `200 {full: boolean}` |
| `GET /api/rooms/:code/ws` | Requires `Upgrade: websocket`; **same-origin `Origin` check** (reject mismatch `403`); rate-limit; forwards to DO `fetch` |
| `GET /api/ice?room=CODE` | Rate-limit; room must exist (DO `status()`); returns `{iceServers}`: STUN always, TURN minted per call (ttl 3600) when secrets set |
| anything else | `ASSETS` with SPA fallback |

`create()`/`status()` are DO RPC methods; only the WebSocket upgrade uses `fetch`. A DO is never reachable by a client-supplied *id string* — only through `idFromName(validatedCode)`, and a DO that was never `create()`d answers `404`/`room-not-found` and stores nothing.

## 5. The Durable Object: `BoothRoom`

**Persisted state** (one `ctx.storage` record, loaded in `blockConcurrencyWhile`; no media, no IPs, no names):

```ts
interface RoomRecord {
  createdAt: number; lastActivityAt: number;
  round: number;                       // 0 until first capture is scheduled
  captureAt: number | null;
  slots: { a?: Slot; b?: Slot };       // a = host (first in), b = guest
}
interface Slot { participantId: string; ready: boolean; photoDone: boolean; lastSeenAt: number }
```

`participantId` is the membership secret (client-generated `crypto.randomUUID()`, kept in `sessionStorage`, per room). It is **never sent to the other participant**; clients only see `slot`.

**Sockets:** Hibernation API. Each socket's attachment holds `{ slot }` after a successful `join`. "Connected" = a live socket for that slot.

**Join rules**
1. A socket's first message must be `join`; anything else → `error not-joined` + close `4400`. A socket that never sends anything holds no slot and costs nothing while hibernating; to stop socket floods the upgrade is refused (`429`) when `ctx.getWebSockets().length ≥ 4` (two slots + headroom for reconnect overlap).
2. Existing `participantId` in a slot → reclaim; close the old socket (`4001 replaced`).
3. New id and a free slot → take it (`a` before `b`).
4. New id, no free slot → a slot is *free* if unoccupied **or** its owner has been disconnected > `SLOT_GRACE_MS` (120 s, evaluated lazily at join, no timer). Otherwise `error room-full`, close `4403`.

**Derived phase** (computed, never stored; sent in `room-state`):
- `waiting` — fewer than 2 connected slots.
- `capture` — `captureAt != null` and `now < captureAt + EXCHANGE_TIMEOUT_MS` (30 s). `captureAt` is set to `null` when both slots are `photoDone`, and lazily when this timeout is found expired (checked whenever phase is computed).
- `ready` — otherwise.

**State transitions**
- `ready`/`unready`: only in phase `ready`, only with 2 connected. When both ready → `round += 1`, `captureAt = now + CAPTURE_LEAD_MS` (4 500 ms = 1.5 s "BOTH READY. GET READY." beat + 3 s countdown), clear ready/photoDone flags, broadcast `capture-scheduled {captureAt, round}` then `room-state`. Once scheduled the round is committed; `unready` is ignored.
- `photo-complete {round}`: sets `photoDone` if `round` matches. Both done ⇒ `captureAt = null`.
- Participant disconnect: clear their `ready`; if phase was `capture`, clear `captureAt` (round cancelled); send `partner-left` to the other. Slot is retained for `SLOT_GRACE_MS`.
- Participant (re)join with a partner present: `partner-joined` to the partner.

**Activity and expiry:** every valid message bumps `lastActivityAt` in memory; it is persisted at most once per 60 s. One DO alarm at `lastActivityAt + 1 h`; when it fires, if `now - lastActivityAt ≥ 1 h` → close all sockets `4000 expired`, `storage.deleteAll()`; else re-arm to `lastActivityAt + 1 h`. Rooms never outlive an hour of silence and nothing is archived.

**Abuse limits (in-DO):** per-socket token bucket (capacity 60, refill 10/s — covers an ICE burst and an 8-ping sync burst); frames > 16 KiB or non-text → close `4400`; bucket empty → `4429`.

**Time caveat:** inside Workers `Date.now()` advances only at I/O boundaries. Our handlers do no CPU-heavy work between receive and reply, so `serverTime` error is sub-millisecond; noted in code comments next to the pong.

## 6. WebSocket protocol (`src/shared/protocol.ts`)

```ts
type ClientMessage =
  | { type: "join"; participantId: string }               // uuid, 8–64 chars [A-Za-z0-9-]
  | { type: "ready" } | { type: "unready" }
  | { type: "offer";  offer: RTCSessionDescriptionInit }   // type "offer",  sdp ≤ 12 KiB
  | { type: "answer"; answer: RTCSessionDescriptionInit }  // type "answer", sdp ≤ 12 KiB
  | { type: "ice-candidate"; candidate: RTCIceCandidateInit } // candidate string ≤ 2 KiB
  | { type: "photo-complete"; round: number }
  | { type: "ping"; clientTime: number };

type ServerMessage =
  | { type: "room-state"; state: RoomState }
  | { type: "partner-joined" } | { type: "partner-left" }
  | { type: "offer"; offer: … } | { type: "answer"; answer: … } | { type: "ice-candidate"; candidate: … }
  | { type: "capture-scheduled"; captureAt: number; round: number }
  | { type: "pong"; clientTime: number; serverTime: number }  // echoes clientTime
  | { type: "error"; code: ErrorCode };

interface RoomState {
  code: string; you: "a" | "b"; phase: "waiting" | "ready" | "capture";
  round: number; captureAt: number | null;
  participants: { a: PState | null; b: PState | null }; // PState = { connected, ready, photoDone }
}
type ErrorCode = "invalid-message" | "not-joined" | "room-full" | "room-not-found" | "rate-limited" | "expired";
```

`parseClientMessage(raw: unknown): ClientMessage | null` — strict: exact `type` match, own-key whitelist (unknown keys rejected), type/length checks. Signaling messages are relayed **verbatim after validation** to the other slot only, and only when that slot is connected; otherwise dropped. A single DO serializes events, so a stale answer/candidate from an old socket can never arrive after the `partner-left`/`partner-joined` that supersedes it — no negotiation epoch is needed.

**Close codes:** `4000` expired · `4001` replaced by newer socket · `4400` invalid/oversize/not joined · `4403` room full · `4404` not found · `4429` rate-limited.

## 7. Clock synchronization and capture (`lib/sync.ts`, `hooks/useSyncClock.ts`)

NTP-style, per brief §16:

1. Client sends `ping {clientTime: t0}`; server replies `pong {clientTime: t0, serverTime: ts}`; client records `t1 = Date.now()` on receipt.
2. `rtt = t1 - t0`; `offset = ts - (t0 + rtt/2)` (server minus client, assuming symmetric path).
3. Take **8 samples 250 ms apart** after `join`, and **4 more each time the user presses Ready**. Keep the sample with the **lowest RTT** (least queuing ⇒ least asymmetry). Maintain `synchronizedNow() = Date.now() + serverOffset`.
4. Error bound: ± rtt/2 of the best sample (typically ≤ 20–40 ms on residential links). Documented in README with the limits: capture jitter = clock error + `setTimeout`/`rAF` granularity (≤ 16 ms) + camera frame interval (≈ 33 ms @ 30 fps). **Claim: "within roughly 1–3 camera frames"**, not "exact".

**Capture path.** On `capture-scheduled {captureAt, round}`:
- Sleep with `setTimeout` to `captureAt − 40 ms` (in `synchronizedNow` terms), then spin on `requestAnimationFrame` until `synchronizedNow() ≥ captureAt`, then `drawImage` immediately. No countdown animation tick ever triggers the capture.
- The visible 3-2-1 is **derived** each frame from `ceil((captureAt − synchronizedNow()) / 1000)`: `>3` → "BOTH READY. GET READY.", `3,2,1`, then `SNAP!` at ≤ 0. If the message arrives so late that `synchronizedNow() > captureAt + 1500`, the client skips the shot, shows "MISSED IT", and sends nothing (server timeout returns the room to `ready`).
- `CAPTURE_LEAD_MS` is a constant in `shared/constants.ts`; clients never choose it.

## 8. WebRTC and photo exchange

**Roles.** Slot `a` is the only offerer; no perfect-negotiation machinery is needed. The server answers every `join` with a `room-state` (the *join snapshot* — the first `room-state` on each socket). Slot `a` **builds a fresh `RTCPeerConnection` and sends an offer** on exactly two triggers: (1) `partner-joined`, (2) a join snapshot that shows slot `b` already connected. Later `room-state` broadcasts (ready flags etc.) never trigger a rebuild. Slot `b` never offers; on **every incoming `offer` it closes any old connection and builds a fresh one to answer**. Consequence: if either side's WebSocket drops and returns, the server emits `partner-joined` to the other side or a join snapshot to the returner, and `a` always ends up re-offering — including the case where `a` itself reconnected while its old media path was still alive (the guest simply replaces its connection when the new offer lands).

**ICE servers.** Before each connection build the client calls `GET /api/ice?room=CODE`. Server decides STUN vs STUN+TURN; the client treats the list as opaque, so adding TURN later needs only the two secrets (brief §18). Default STUN `stun:stun.cloudflare.com:3478`.

**Connection.** `addTrack` for the local video; `ontrack` → remote `<video>`; trickle ICE over the WebSocket, with remote candidates buffered until `setRemoteDescription` resolves; `addIceCandidate` errors are caught and ignored (stale). `iceconnectionstatechange`: `disconnected` ⇒ "RECONNECTING" badge; `failed` ⇒ one `restartIce()` by the offerer, then if still not `connected` after 10 s ⇒ **WebRTC failure screen** (RECONNECT rebuilds the connection; if the WebSocket is up it does not rejoin).

**Camera switching.** `FLIP CAMERA`: on mobile toggles `facingMode` `user`/`environment`; on desktop cycles `enumerateDevices()` video inputs. Uses `RTCRtpSender.replaceTrack` — **no renegotiation**.

**Photo DataChannel.** `createDataChannel("photos", { negotiated: true, id: 0, ordered: true })` on *both* sides (no `ondatachannel` race). Protocol on the channel — `{"t":"cam","mirrored":bool}` (text; sent when the channel opens and whenever the local camera changes, drives the partner's THEM-frame mirroring), then per photo:
`{"t":"photo","round":n,"mime":"image/jpeg","size":N}` (text) → binary chunks of **16 KiB** → `{"t":"end","round":n}`. Sender honours back-pressure via `bufferedAmountLowThreshold` (256 KiB). Receiver validates `size ≤ 3 MiB`, round matches the expected round, and assembles a `Blob`. On `end` both ends mark their side done; when a client holds its own photo **and** the partner's, it sends `photo-complete {round}`.

## 9. Photos (`lib/photo.ts`, `lib/filters.ts`)

- **Capture:** `canvas.width/height = video.videoWidth/Height; ctx.drawImage(video,0,0)` → downscale so the longer edge ≤ **1280 px** → `canvas.toBlob("image/jpeg", 0.85)`. **Preview = result (D15):** when `mirrored` is true the capture draws with `ctx.translate(w,0); ctx.scale(-1,1)` before `drawImage`, so the pixels match the CSS-flipped preview (`CameraFrame` applies `scaleX(-1)` from the same boolean). The sender mirrors before compressing, so the receiver gets final pixels; the receiver's THEM frame is flipped from the partner's `cam` message so *its* preview matches that photo too. `cam` defaults to `mirrored: true` until the first message arrives (almost always before the first frame).
- **Rounds store:** client-side list of *completed* rounds `{ round, a: Blob, b: Blob }`, keeping the last 2. A cancelled round (partner left mid-capture) leaves no entry, so "N−1" below means "the previous completed round", not literally `round − 1`. Slot `a`'s photo is always first/left/top in every layout, so both people compose identical strips.
- **Filters** (brief §25): `original · bw · warm · cool · vintage · contrast`, implemented as pure per-pixel functions over `ImageData` (works on Safari, which cannot be relied on for `ctx.filter`). A filter is a **local choice** — each person picks their own; it is not synchronized.
- **Layouts:** `vertical` (default; latest round) · `horizontal` (latest round) · `grid` (rounds N−1 and N: `A1|B1 / A2|B2`; disabled until 2 rounds exist). `layoutStrip(layout, photoCount)` is a **pure function returning pixel rects** so it is unit-testable.
- **Cells:** 4:3 landscape, center-"cover" crop; the live `CameraFrame` uses the same aspect and `object-fit: cover`, so what you see is what you crop. `CELL_ASPECT` is one constant.
- **Strip look:** cream paper, 4 px black border, ≤ 0.8° deterministic jitter per frame (PRNG seeded from `code + round`, so partners' strips match), a drawn star sticker, footer `BOOTH A7K9XM · 07 OCT 2026` (local date of the last `captureAt`). Fonts must be loaded (`document.fonts.load`) before drawing text to canvas.
- **Download:** PNG or JPG via `canvas.toBlob` + `<a download>`. **Share:** `navigator.canShare({files})` → `navigator.share`; fallback toast `PHOTO SAVED.` and the download button. A `beforeunload` guard warns while unsaved photos exist (photos live only in memory).

## 10. Client structure and screens

```
src/client/
  main.tsx  App.tsx (router)  index.css (tokens)
  components/  BrutalButton BrutalCard BrutalInput BrutalBadge BrutalModal BrutalToast
               BrutalLabel BrutalDivider CameraFrame Countdown PhotoStrip RoomCode
               ConnectionStatus ErrorScreen FilterPicker
  hooks/       useCamera useRoom useSyncClock useWebRTC
  lib/         camera.ts webrtc.ts photo.ts sync.ts filters.ts
  pages/       Home CreateBooth JoinBooth Booth
src/shared/    protocol.ts constants.ts room-code.ts
src/worker/    index.ts BoothRoom.ts ice.ts
```

Every component in the brief's list exists *because something uses it*: `BrutalModal` → QR code; `BrutalToast` → "LINK COPIED" / "PHOTO SAVED."; `BrutalDivider`/`BrutalLabel`/`BrutalBadge` → landing + camera tags + status. No unused placeholder components.

**Routes:** `/` Home · `/create` CreateBooth · `/join` JoinBooth · `/b/:code` Booth (the shareable URL and QR target).

**Booth screen state** (derived in `Booth.tsx` from hook outputs; no state library):
`checking` (GET /api/rooms/:code) → `camera` (explicit "TURN ON CAMERA" button — a user gesture, which iOS Safari wants) → `connecting` → `lobby` (alone: code, copy link, QR, YOU●/THEM○) → `ready-check` → `countdown` → `exchanging` → `result`.
Overlays/errors: camera-blocked · room-full · not-found/expired · partner-left (THEY LEFT :( — waits, EXIT) · WebRTC-failed (RECONNECT) · connection-lost (WebSocket reconnect with backoff 0.5→5 s up to ~60 s, same `participantId`, then CONNECTION LOST/RECONNECT).

**Layout.** Desktop: two camera frames side by side, controls below. Mobile: THEM on top, YOU below, thumb-sized controls, `padding: env(safe-area-inset-*)`, `100dvh` sizing so the URL bar doesn't hide the Ready button. Result screen follows brief §26 with a huge DOWNLOAD PHOTO button.

## 11. Neo-Brutalist design system

Tokens in Tailwind v4 `@theme` (hex values below are the starting point; contrast is verified in implementation):

| Token | Value | Use |
|---|---|---|
| `paper` | `#FFF8E7` | page background |
| `ink` | `#0A0A0A` | text, borders, shadows |
| `yellow` | `#FFE600` | primary CTA |
| `pink` | `#FF4FA3` | secondary accent |
| `blue` | `#2F5BFF` | status / links (white text) |
| `lime` | `#B6FF3B` | READY ✓ / connected |
| `orange` | `#FF8A1F` | warnings |
| `purple` | `#8B5CF6` | decoration only (ink text) |

- Borders: 3 px default, 4 px for key cards. Radius: 0 / 2 / 4 / 8 px max. **No blur, no soft shadows, no gradients.**
- Shadow `--shadow-brutal: 5px 5px 0 var(--ink)`. Press: `translate(4px,4px)` + `1px 1px 0`, ≤ 80 ms, transform-only.
- Type: Space Grotesk (variable, 700–900) for display and UI; hero ≈ `clamp(3.5rem, 14vw, 11rem)`, line-height 0.9, uppercase labels; countdown numeral fills the frame and "pops" via `transform: scale`.
- **One dominant accent per screen** + one or two supporters (Home: yellow + pink; lobby: lime; result: pink; errors: orange).
- Decorative glyphs (★ ✦ ! + 01 02 SYNC LIVE REC CAPTURE) are `aria-hidden` text/CSS, sparse.
- Camera frames: 4 px black border, hard shadow, tilted tag labels (`YOU`, `THEM`, `CAM`, `REC`) offset off the frame corner; no glass overlays.
- Landing, join input (label-maker/industrial: monospaced-feeling tracked caps, chunky), copy per brief §40.

## 12. Accessibility

Real `<button>`/`<a>`/`<input>` elements; visible focus ring (3 px ink + 3 px yellow offset, never removed); keyboard-operable everything, including FilterPicker (radio group) and the QR modal (focus trap, Esc closes, returns focus); `aria-live="polite"` region announcing countdown numbers and connection changes; video tags have `aria-label`s; colour is never the only state signal (text + glyph "READY ✓"); `prefers-reduced-motion: reduce` disables press/pop/tilt animations (state changes become instant); text/background pairs target ≥ 4.5:1 (checked in implementation).

## 13. Security and privacy

- Strong room codes (D2); only `idFromName(validatedCode)`; never-created rooms store nothing; max two participants; `participantId` secrecy (§5); strict validation of every WS frame (§6); same-origin check on upgrade (blocks other sites from driving our rooms from a victim's browser); per-IP HTTP rate limits + per-socket bucket (D12); expiry and `deleteAll` (§5); no analytics, no logging of IPs/ids; no secrets in client bundle (TURN token stays a Worker secret; client only ever receives short-lived credentials).
- `public/_headers`: `Content-Security-Policy` (`default-src 'self'; connect-src 'self' wss:; img-src 'self' blob: data:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'`), `Permissions-Policy: camera=(self), microphone=()`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`.
- Privacy copy exactly per brief §32. It says "directly … *when possible*" because with TURN configured, media is relayed (still DTLS-SRTP-encrypted; the relay cannot decrypt it) — the copy does not claim otherwise.

## 14. Testing and what can and cannot be verified here

**Automated (run in this environment):**
- `tsc -b` (client, worker, test configs) and `eslint .` clean.
- **Unit (Vitest, node):** protocol validators (valid, wrong type, extra keys, oversize SDP/candidate); `room-code` (alphabet, length, uniform-ish distribution, normalization); `sync` (offset math, min-RTT selection, asymmetric-path bound); `filters` (identity for original, `r=g=b` for bw, clamping); `layoutStrip` (rect counts/dimensions per layout, cover-crop math); DataChannel chunking/reassembly.
- **Worker + DO (`@cloudflare/vitest-plugin`):** create → exists; invalid code `400`; unknown `404`; join two; third rejected `room-full`; reconnect with same `participantId` reclaims and replaces socket; slot freed after grace; both-ready ⇒ one `capture-scheduled` with identical `captureAt ≈ now + lead` to both; partner disconnect cancels round and sends `partner-left`; signaling relays only to the partner; `ping`→`pong` echoes `clientTime`; bad JSON / oversize / pre-join messages rejected; bucket exhaustion `4429`; expiry via alarm leaves empty storage.
- **E2E (Playwright, Chromium, two browser contexts):** launched with `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream`. This feeds Chromium's built-in test pattern into `getUserMedia`; it is a *test harness* — the product code is unchanged and still calls real `getUserMedia`/WebRTC/WebSocket. Asserts: both see remote video (`videoWidth>0`, `currentTime` advancing); both ready ⇒ same `captureAt`; capture timestamps (exposed on a dev-only `window.__booth` hook) differ by < 150 ms on localhost; each side ends with 2 photos; a frame's preview flip (`transform: scaleX(-1)`) is present iff the dev-hook `lastCapture.mirrored` is true for that person, on both the YOU and THEM frames; strip canvas has expected dimensions; download triggers a file; partner reload ⇒ reconnect works; third context sees BOOTH FULL; permission-denied context sees CAMERA BLOCKED; `reducedMotion: 'reduce'` run.

**Not verifiable from this environment — owner must test (README has the checklist):** iPhone Safari and Android Chrome behaviour; two physical phones on different networks (the real STUN/TURN path); Firefox and desktop Safari; actual Cloudflare deployment (needs `wrangler login`, which is interactive and publishes outward — **I will not run `deploy` without explicit approval**); real TURN credential minting (needs the owner's Cloudflare TURN key); real-camera sync quality. The final report will list each brief §47 item as *verified here*, *needs your device*, or *not done*, with no blanket "tested" claims.

## 15. Build phases and gates (brief §45)

Each phase ends with a gate; do not start the next until it passes.

1. **Plumbing** — scaffold; Worker + `BoothRoom`; create/join; camera; WebRTC; two live feeds. *Gate:* DO tests + e2e "both see remote video" green; typecheck + lint clean.
2. **Sync** — ready flow; clock sync; server-scheduled capture; derived 3-2-1. *Gate:* sync unit tests + e2e "same captureAt, capture Δ < 150 ms".
3. **Photos** — capture/compress; DataChannel exchange; strip; PNG/JPG download. *Gate:* e2e "2 photos each side, strip dimensions, download".
4. **Polish** — full Neo-Brutalist pass; filters; layouts incl. grid; QR; share; error screens; reduced-motion; README (deploy, local dev, HTTPS for phones, manual checklist). *Gate:* all automated checks green + README checklist written.

## 16. Local dev, HTTPS and deployment (README outline)

- `npm install` · `npm run dev` (Vite + workerd via the Cloudflare plugin; `localhost` is a secure context, so camera works on desktop) · `npm run typecheck` · `npm run lint` · `npm test` · `npm run test:e2e` · `npm run deploy` (`vite build && wrangler deploy`) · `npx wrangler login` (first time).
- **Phones need HTTPS** (secure context): recommended `cloudflared tunnel --url http://localhost:5173` for a throwaway public HTTPS URL (`server.allowedHosts` includes `.trycloudflare.com`); alternative: deploy to `workers.dev`. The README states both and the caveat that a tunnel exposes the dev server publicly while it runs.
- TURN (optional): create a Cloudflare Realtime TURN key; set `TURN_KEY_ID` (var) and `npx wrangler secret put TURN_KEY_API_TOKEN`; local: `.dev.vars`. No frontend change.
- Rate-limit `namespace_id` must be unique per account — documented next to the config.

## 17. Open assumptions (shout if wrong)

1. "Preview same as result" means **mirroring and crop** (D15, §9 cell aspect). Filters are applied only after capture, on the result screen; there is no live filtered preview. Say so if you meant that too.
2. A partner can start another round only by *both* pressing ready; nobody is moved off the result screen unilaterally.
3. Filter and layout are per-person, not shared.
4. Strip date uses each person's local timezone (partners across midnight may differ by a day).
5. Chromium is the only automated browser; WebKit/Firefox are manual.
6. Git: the repo at `explore/photobooth/` already exists (`master`). I commit after each implemented change — Conventional Commits, **no `Co-Authored-By` or "Generated with" trailers** — and never push.
