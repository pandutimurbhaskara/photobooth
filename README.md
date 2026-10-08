# TWO-UP — a two-person synchronized photo booth

Two people open the same private room on separate devices, see each other live over WebRTC, press ready, watch a
synchronized 3-2-1, and each browser captures at the same server-defined instant. The photos are exchanged
peer-to-peer and composed into a downloadable photo strip. Neo-Brutalist UI. No accounts.

`TWO-UP` is a placeholder name (one constant, `APP_NAME` in `src/shared/constants.ts`).

```
 Browser A ──┐   HTTPS / WSS            ┌── Worker  (src/worker/index.ts)
             ├────────────────────────►─┤     POST /api/rooms          create
 Browser B ──┘                          │     GET  /api/rooms/:code    exists / full?
    ▲   ▲                               │     GET  /api/rooms/:code/ws upgrade → Durable Object
    │   └─ WebRTC: video + photo ──────►│     GET  /api/ice?room=      STUN (+ TURN)
    │      DataChannel, peer to peer    │     *    → static assets (the React app)
    └───────────────────────────────────┘          │
                                                   ▼
                                         Durable Object `BoothRoom`  (one per booth, SQLite-backed, hibernating)
```

- **Video never touches the Worker or the Durable Object.** The Durable Object carries signaling, ready state, clock
  sync and capture scheduling only.
- **Photos never touch the server.** They are captured, filtered, composed and downloaded in the browser.

## Run it locally

```bash
npm install
npm run dev            # http://localhost:5173  (localhost is a secure context, so the camera works)
npm run check          # typecheck + lint + unit/worker tests
npm run e2e:install    # once: downloads Chromium for Playwright
npm run test:e2e       # real browsers, real WebRTC (starts its own dev server on :5199)
```

Open `http://localhost:5173`, press **CREATE A BOOTH**, and open the booth link in a second browser profile or
window (a normal and an incognito window work). Allow the camera in both.

## Test on a phone

Phones need **HTTPS** to open the camera. Two options:

1. **Quick tunnel (recommended):** `npm run dev`, then in another terminal
   `cloudflared tunnel --url http://localhost:5173`. Open the printed `https://….trycloudflare.com` URL on both
   phones. `vite.config.ts` already allows that host. *While the tunnel runs your dev server is reachable by anyone
   who has the URL.*
2. **Deploy** to `workers.dev` (below) and test there.

## Deploy

```bash
npx wrangler login     # once, interactive
npm run deploy         # vite build && wrangler deploy
```

`wrangler.jsonc` binds: the `BoothRoom` Durable Object (declared with the `exports` field, SQLite storage), the static
assets with SPA fallback (`/api/*` runs the Worker first), and two rate-limit namespaces (`RL_CREATE` 20/min and
`RL_LOOKUP` 120/min per IP). The rate-limit `namespace_id` values must be unique in your Cloudflare account — change
them if they collide. Add routes or a custom domain in the Cloudflare dashboard or with a `routes` entry. R2 is
deliberately **not** used: photos never leave the browsers.

### TURN (optional)

Without TURN the app uses STUN only, which connects most home networks directly but fails on strict NATs. **Treat TURN as
effectively required for the headline use case:** two phones on different mobile carriers usually sit behind
carrier-grade NAT, where STUN-only often fails.

1. Create a Cloudflare Realtime TURN key.
2. Put its id in `wrangler.jsonc` under `vars.TURN_KEY_ID`.
3. `npx wrangler secret put TURN_KEY_API_TOKEN` (local dev: copy `.dev.vars.example` to `.dev.vars`).

The browser only ever receives short-lived credentials minted by `/api/ice`; no long-lived secret reaches a client.
With TURN configured, media can be relayed (still end-to-end encrypted by DTLS-SRTP), which is why the privacy copy
says "directly **when possible**".

Because every credential costs relay bandwidth, `/api/ice` only answers same-site callers who are actually in the room
(by their participant id), at most 30 per room per hour, on top of the per-IP limit. A leaked room code cannot drain
your allowance, but set a billing alert on your Cloudflare account anyway.

## How synchronization works

The server owns time. When both people are ready, `BoothRoom` picks one timestamp (`captureAt`, 4.5 s ahead) and
sends it to both.

1. **Clock offset.** Each client pings the server (8 pings at join, 4 more each time READY is pressed) and estimates
   `serverOffset = serverTime − (t0 + rtt/2)`. The **lowest-RTT sample** wins (least queuing, least asymmetry); only the
   last 12 samples count. `synchronizedNow() = Date.now() + serverOffset`.
2. **Capture.** `setTimeout` to 40 ms before `captureAt`, then spin on `requestAnimationFrame` until
   `synchronizedNow() ≥ captureAt`, then `drawImage` from the live `<video>`.
3. **The 3-2-1 is cosmetic.** The numerals are derived from the same timestamp every frame; the capture never waits
   for the animation.
4. **A repeated or very late message** (a replay after reconnecting, a stalled phone) captures once, or — if more than
   1.5 s late — shows MISSED IT instead of taking a late photo. The same goes for a page that was throttled or
   suspended (a backgrounded tab): if the timer fires more than 1.5 s after the shared moment, that is MISSED IT, not a
   "simultaneous" photo taken whenever the tab woke up.
5. **A round that does not complete** (a missed shot, a slow or broken partner) is ended by the server 30 s after
   `captureAt` with an alarm; both people see a clear "THAT ROUND DIDN'T WORK. GO AGAIN." and can press ready again. It
   is deliberately not reported as a network failure.

**Honest accuracy:** the two captures land within roughly **one to three camera frames** — clock error (≤ half the
RTT of the best sample) + timer granularity (≤ 16 ms) + the camera's own frame interval (~33 ms at 30 fps). It is
close, not exact. On one machine the e2e test measures a spread under 150 ms.

## Preview = result

A camera frame is mirrored on screen exactly when the photo taken from it is mirrored — on your own frame and on the
partner's. Front cameras and webcams mirror; a rear camera does not. Each browser tells the other whether its camera is
mirrored over the data channel, so the THEM frame matches the photo you will get of them. Filters are applied after
capture, on the result screen only (there is no live filtered preview).

## Privacy and security

- The Durable Object stores: room code, round counter, the two participant ids, ready flags, the shared booth plan
  (template, cell kinds, take round numbers) and timestamps. No names, IPs, media or photos. A room is deleted after an
  hour of silence.
- The participant id is a per-tab secret that never leaves the browser except to the server, and is never sent to the
  other participant.
- Room codes are 6 characters from a 31-symbol alphabet (~29.7 bits) drawn with `crypto.getRandomValues` and rejection
  sampling; at most two people per room; per-IP rate limits on create/lookup/ws/ice and a per-socket token bucket;
  every WebSocket frame is validated strictly and size-capped; the WebSocket upgrade checks the `Origin` host.
- `public/_headers` sets a strict CSP (no inline scripts), `Permissions-Policy: camera=(self)`, `nosniff`,
  `Referrer-Policy: no-referrer`.
- Photos are held only in the browser tab. Closing the tab or pressing EXIT after capturing asks first. A finished strip
  is never hidden behind a failure screen (call dropped, socket closed, camera lost): only a round in flight takes the
  screen back.
- Connection health: the client sends a raw `ka` every 20 s which the runtime answers with `ok` without waking the room;
  50 s of silence is treated as a dead (half-open) socket and reconnects. A muted or ended camera track is never captured,
  and a lost camera shows the "no camera" screen with TRY AGAIN instead of a frozen preview.

## Decisions and limits

No audio. No R2. No server-side photo relay: if the data channel fails you see CAMERA CONNECTION FAILED rather than
photos taking a detour through the server. A session picks a format (4-cut, 2 × 2, 2-cut, Polaroid) and, per cell,
USER 1, USER 2 or TOGETHER; each cell takes 2–3 takes and both people keep one; any single cell can be retaken from the
finished screen. The shared choices live in the Durable Object as a small "plan" (enum ids and round numbers only);
photos stay in the tabs. A leaver's slot is reserved for two minutes against strangers. The product name is a
placeholder.

Full design: [`docs/superpowers/specs/2026-10-07-photobooth-design.md`](docs/superpowers/specs/2026-10-07-photobooth-design.md)
(decisions D1–D23) and [`docs/superpowers/specs/2026-10-08-format-and-style-design.md`](docs/superpowers/specs/2026-10-08-format-and-style-design.md)
(D24–D33: format, takes, retake, cutouts; supersedes D13/D14). Implementation plans: `docs/superpowers/plans/`.

## Manual test checklist (needs real devices)

| # | Check | Expected |
|---|---|---|
| 1 | iPhone Safari ↔ Android Chrome on **different networks**, via an HTTPS URL | both see each other; READY → 3-2-1 → both strips match |
| 2 | Deny camera permission on a phone, then allow it in settings and press TRY AGAIN | CAMERA BLOCKED, then recovers |
| 3 | Flip camera (FLIP CAMERA) on a phone with front + rear cameras mid-booth | partner's THEM frame keeps playing, and its mirroring follows the rear/front change |
| 4 | Lock the phone for 20 s during the lobby, then unlock | reconnects, same code, partner still there |
| 5 | Switch phone from Wi-Fi to mobile data mid-booth | RECONNECTING, then connected or a clear RECONNECT prompt |
| 6 | Firefox desktop and Safari desktop: full flow | works; note any difference |
| 7 | Close one tab mid-countdown | the other returns to the lobby; no photo is taken |
| 8 | Download PNG and JPG on iOS Safari and Android Chrome | file opens/saves; strip looks like the on-screen one |
| 9 | SHARE on a phone | system share sheet with the image; on desktop falls back to PHOTO SAVED. |
| 10 | Strict network (corporate Wi-Fi / symmetric NAT) with and without TURN configured | fails clearly without TURN; works with TURN |
| 11 | Reduced motion on in OS settings | no pop/wiggle animation; countdown numerals still change |
| 12 | After `wrangler deploy`: `curl -sI https://<worker>/` | CSP, Permissions-Policy, nosniff, no-referrer present |

## Verification status

Everything below "verified here" was run in this repository on 2026-10-08 (macOS, Node 24, Chromium via Playwright).
Nothing was pushed or deployed.

| Item (brief §47) | Status | Evidence |
|---|---|---|
| TypeScript checker, fix all errors | **verified here** | `npm run typecheck` exits 0 (client, worker and node projects) |
| Lint, fix all errors | **verified here** | `npm run lint` exits 0 |
| Imports | **verified here** | covered by `tsc -b` and the production build |
| Cloudflare bindings | **verified here** | `wrangler types` generates `BOOTH_ROOM`, `RL_CREATE`, `RL_LOOKUP`, `ASSETS`; worker tests exercise every binding; build output keeps the Durable Object `exports` |
| Durable Object behaviour (workerd) | **verified here** | 72 worker tests: join/reclaim/full/leave, relay, ping, rate limit, expiry and capture-timeout alarms, hibernation, keepalive, ready/capture scheduling, ICE gating, the shared plan (stages, takes, retake, reset, ready-clearing) |
| Durable Object **deployment** | **not done** | needs `wrangler login` + `wrangler deploy` (interactive, publishes outward) |
| WebSocket connections | **verified here** | worker tests + every e2e spec |
| Two browsers simultaneously | **verified here** | 38 Playwright tests (`npm run test:e2e`, 6.6 min), two or three isolated Chromium contexts each |
| Synchronized capture | **verified here** | e2e: capture spread < 150 ms on one machine, repeated 10× with 0 failures. Real-device accuracy: checklist row 1 |
| Photo generation | **verified here** | strips 1056×1800 (2-cut) / 1056×1032 (Polaroid) / 2064×1800 (2 × 2) asserted in e2e; 4-cut 1056×3336 asserted at unit level; B&W filter verified by pixel sampling |
| Download | **verified here** | PNG and JPG download events with the expected file names. File contents on real phones: row 8 |
| Format, takes, pick, retake | **verified here** | e2e: format cards and per-cell kinds sync to both screens; READY clears when the plan changes; 2–3 takes; either person changes the kept take; retake one cell; a reload loses photos → START OVER; the partner's strip survives |
| Camera permissions | **verified here (simulated)** | blocked / no camera / no camera API screens via a stubbed `getUserMedia`. Real browser permission prompts: row 2 |
| Disconnect / reconnect | **verified here** | partner leaves mid-countdown, reload rejoins a full booth, second tab replaces the first, a partner whose call dies while their socket stays open (the strip stays downloadable), a capture message delivered 7 s late (MISSED IT, then the round recovers for both), socket backoff and keepalive unit-tested. Real network switch / locked phone: rows 4, 5 |
| Mobile layout | **verified here (emulated)** | 390×844 Chromium: no sideways scroll, READY ≥ 48 px and on screen. Real phones: rows 1, 8 |
| Desktop layout | **verified here** | default desktop Chromium viewport |
| Reduced motion | **verified here** | animation duration forced to ~0 with the preference, > 50 ms without |
| Accessibility | **verified here** | axe WCAG 2 A/AA: 0 violations on home, join, not-found, camera gate, lobby, stage, result (`video-caption` rule disabled: live silent streams) |
| Security headers / CSP | **verified here (build)** | served by the production preview; a full two-person run against that build produced 0 CSP violations. Deployed behaviour: row 12 |
| Two physical phones, different networks | **needs your device** | rows 1, 5, 10 |
| iPhone Safari, Android Chrome, Firefox, desktop Safari | **needs your device** | rows 1, 6, 8 |
| Real TURN | **needs your device** | row 10 and a Cloudflare TURN key |

Test counts: **239** unit + worker tests across 17 files; **29** end-to-end tests across 8 spec files.

**Known issues and notes**

- One end-to-end failure occurred once, on the very first run against a freshly started dev server (remote video did
  not decode within 15 s). It did not recur in 40+ later runs, cold caches and cold servers included. Traces are kept on
  failure — if it recurs, read the trace first.
- `npm audit` reports 5 high-severity findings, all in local development tooling (`wrangler` → `miniflare` → `sharp`
  → librsvg). **Production dependencies: 0 findings.** Nothing from that chain is shipped. Re-check after updating
  Wrangler; do not use `npm audit fix --force` blindly.
- The camera cannot be flipped in e2e (Chromium's fake device exposes a single camera): FLIP CAMERA is
  device-checklist row 3.
- The first-run failure above is unexplained. One hypothesis (not confirmed): macOS 15's one-time Local Network privacy
  prompt for a newly installed Chromium stalling ICE/mDNS candidates past the 15 s poll.

**Deferred from the final code review** (known, graded Minor, not fixed — details in the review notes):

- Clock sync keeps the lowest-RTT sample for 12 samples, so a wall-clock step while an old best sample is still in the
  window skews the offset until it ages out (use a monotonic clock for RTT).
- A stale answer arriving after a peer rebuild throws and flips the call to "failed" (add an offer id to the answer).
  Early ICE candidates that arrive before their offer, and offers/answers sent while the socket is not open, are dropped
  silently.
- A hostile partner can send zero-length data-channel chunks (unbounded count) or a tiny JPEG with enormous declared
  dimensions (decode bomb) to stall *your* tab; one corrupt partner image also disables DOWNLOAD for the whole strip.
- The side whose socket blipped does not cancel its own countdown when the server cancels the round.
- A room expires an hour after the last ready/signal message even while two people are still on video.
- "CAMERA NEEDS HTTPS" is also what in-app browsers (WhatsApp, LINE, Instagram) show; pasting a URL followed by
  punctuation is rejected; the strip date is render time, not capture time.
- A failure *during a second round* shows the full-screen error whose exit links skip the "leave without saving?" prompt.
- Cosmetic: the desktop lobby's oversized room code wraps onto two lines, and on a phone the sticky BOTH READY card
  covers the lower half of your own preview until you scroll.
- Room codes are ~29.7 bits and the lookup is a 200/404 oracle (owner-accepted); use 8 characters before a public launch.
