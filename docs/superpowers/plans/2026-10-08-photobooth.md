# Two-Person Synchronized Photo Booth (TWO-UP) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Read this master file first, then the phase file that holds your task.** Each phase file is self-contained for its tasks and ends in a gate that must pass before the next phase starts.

**Goal:** A web app where two people on separate devices open a private room, see each other over WebRTC, press ready, watch a server-synchronized 3-2-1, capture at the same instant, exchange photos peer-to-peer, and download a photo strip — in a Neo-Brutalist UI.

**Architecture:** One Cloudflare Worker serves the SPA (static assets) and a small `/api` surface; one SQLite-backed, hibernating Durable Object (`BoothRoom`) per booth does WebSocket signaling, ready state, clock sync and capture scheduling only. Video and photos travel browser↔browser (WebRTC media + a negotiated DataChannel). All photo work (capture, filter, compose, download) is local canvas code.

**Tech Stack:** React 19 · TypeScript ~6.0 · Vite 8 + `@cloudflare/vite-plugin` · Tailwind v4 · react-router 8 · Cloudflare Workers/Durable Objects/Rate Limiting binding · Vitest 4 + `@cloudflare/vitest-plugin` · Playwright (Chromium) · `qrcode`.

**Spec:** `docs/superpowers/specs/2026-10-07-photobooth-design.md` (decisions D1–D23 are binding; where this plan and the spec disagree, stop and flag it).

## Phase files

| Phase | File | Tasks | Gate |
|---|---|---|---|
| 1 Plumbing | `2026-10-08-photobooth-phase-1-plumbing.md` | 1–11 | DO + worker tests green; e2e "two browsers see each other"; typecheck + lint clean |
| 2 Sync | `2026-10-08-photobooth-phase-2-sync.md` | 12–15 | sync unit tests; e2e "same round, capture Δ < 150 ms"; partner-leave cancels |
| 3 Photos | `2026-10-08-photobooth-phase-3-photos.md` | 16–19 | e2e "each side holds both photos, strip dimensions, download" |
| 4 Polish | `2026-10-08-photobooth-phase-4-polish.md` | 20–25 | all automated checks green; README + manual checklist written |

## Global Constraints

Every task's requirements implicitly include this section. Values are copied from the spec.

**Architecture rules**
- Video never touches the Worker or the Durable Object. Photos never touch the server. The DO carries signaling, ready state, clock sync and capture scheduling only.
- No accounts, no analytics, no IPs or names stored. No R2. No audio (`getUserMedia({ audio: false })`).
- Product code never fakes the camera, WebRTC, WebSocket or timestamps. (Playwright's Chromium fake-device flags are a *test harness* only.)
- Photo exchange uses only the DataChannel. **No** WebSocket/DO fallback for photos (D11).
- Ready/capture are server-scheduled; there is **no** `schedule-capture` client message (D3). RETAKE = press ready again (D14). No ICE restart; RECONNECT = rejoin the room (D17).

**Versions / dependencies** (ranges; resolve at install)
- `typescript ~6.0.3` (**not 7** — typescript-eslint peers `<6.1`), `vitest ^4.1` (**not 5**), `@cloudflare/vitest-plugin ^1.3`, `vite ^8`, `@cloudflare/vite-plugin ^1.63`, `wrangler ^4.148`, `react ^19.2.7`, `react-router ^8`, `tailwindcss ^4.3`, `eslint ^10`, `typescript-eslint ^8.71`, `@playwright/test ^1.63`, `qrcode ^1.5`, `@fontsource-variable/space-grotesk ^5`.
- No state library, no zod, no CSS-in-JS, no UI kit. Hand-written message validators. npm only (never yarn/pnpm/bun).
- Config: `wrangler.jsonc` with the declarative `exports` field (`type: "durable-object"`, `storage: "sqlite"`) — **not** `migrations` (D1). If the installed Wrangler rejects `exports`, fall back to `"migrations": [{ "tag": "v1", "new_sqlite_classes": ["BoothRoom"] }]` (remove `exports`), and record that in the spec's D1 row in the same commit.

**Constants** (all live in `src/shared/constants.ts`; nothing hard-codes them elsewhere)
- Room code: 6 chars, alphabet exactly `ABCDEFGHJKMNPQRSTUVWXYZ23456789`, uniform via rejection sampling (accept byte `< 248`).
- `CAPTURE_LEAD_MS = 4500` · `EXCHANGE_TIMEOUT_MS = 30000` · `SLOT_GRACE_MS = 120000` · `ROOM_IDLE_MS = 3600000` · `ACTIVITY_PERSIST_MS = 60000`.
- `MAX_WS_FRAME_BYTES = 16384` · `MAX_SDP_CHARS = 12288` · `MAX_CANDIDATE_CHARS = 2048` · `BUCKET_CAPACITY = 60` · `BUCKET_REFILL_PER_SEC = 10` · `MAX_SOCKETS = 4`.
- Photos: longest edge ≤ `1280` px, JPEG quality `0.85`, ≤ `3 MiB`, DataChannel chunk `16 KiB`, cell aspect `4/3`.
- Close codes: `4000` expired · `4001` replaced · `4400` invalid · `4403` full · `4404` not found · `4429` rate-limited.
- Rate limits (D23): create 20 / 60 s per IP; lookup + ws + ice 120 / 60 s per IP.

**Look and copy**
- Neo-Brutalist: borders 3 px (key cards 4 px), radius ≤ 8 px, hard shadows only (`5px 5px 0 #0a0a0a`), **no blur, no soft shadows, no gradients**, press = `translate(4px,4px)` + `1px 1px 0`. Palette tokens: `paper #fff8e7`, `ink #0a0a0a`, `yellow #ffe600`, `pink #ff4fa3`, `blue #2f5bff` (white text), `lime #b6ff3b`, `orange #ff8a1f`, `purple #8b5cf6` (ink text). One dominant accent per screen.
- Copy is taken verbatim from the brief: hero `MAKE / SOMETHING / WORTH / KEEPING.`; subtitle `A TWO-PERSON PHOTO BOOTH / FOR PEOPLE WHO AREN'T / IN THE SAME PLACE.`; `CREATE A BOOTH →`; `JOIN A BOOTH`; `WAITING FOR YOUR PERSON...`; `READY WHEN YOU ARE.`; `HOLD STILL. THIS ONE'S GOOD.`; `LOOK WHAT YOU MADE.`; `BOTH READY. GET READY.`; error screens exactly as brief §31; privacy text exactly as brief §32.
- Mobile first: `viewport-fit=cover`, `env(safe-area-inset-*)`, `100dvh`, thumb-sized controls. Accessibility: real buttons, visible focus ring, `aria-live` countdown, `prefers-reduced-motion` honoured, colour never the only signal.

**Process**
- TDD for logic: failing test → run → minimal code → pass.
- Commit after each implemented task (more often if a task has a natural checkpoint). **Conventional Commits** (`feat fix docs refactor test chore ci perf`), lowercase imperative summary, no trailing period. **No `Co-Authored-By` or "Generated with" trailers. Never push.** Stage explicit paths, not `git add -A`, unless the task says otherwise.
- Every code step shows the code. If reality (a tool version, a changed API) forces a different shape, change it, make the tests pass, and note the deviation in the task's commit body.

## Review Focus

Five inputs/conditions the spec implies but would not otherwise be exercised. Each has a test in the task named.

1. **Both people press READY in the same instant** → the Durable Object schedules exactly one round (not two, no double `capture-scheduled`). *Test: Task 12.*
2. **`capture-scheduled` delivered twice, or very late** (reconnect replay, slow phone) → capture exactly once; if more than 1.5 s late, show MISSED IT instead of capturing. *Test: Task 14.*
3. **The `<video>` has no frame yet at `captureAt`** (`videoWidth === 0`, camera still waking) → a typed error, never a blank/0×0 photo. *Test: Task 16.*
4. **The partner's DataChannel sends a hostile or broken photo** (wrong round, declared size over 3 MiB, truncated, overflowing, binary with no header, junk JSON) → rejected without throwing and without a half-built image. *Test: Task 17.*
5. **A person types the code lowercase, with a space or hyphen, or pastes the whole booth URL** → they land in the right booth; look-alike letters (`O`, `I`, `L`, `0`, `1`) are refused. *Tests: Task 2 (logic) and Task 21 (form).*

Also covered inside their owning tasks: zero pongs (offline) keeps READY disabled (Task 13); a reload by someone already in a full booth is *not* told "full" (Tasks 4, 6, 7); a replaced second tab does not fight for the room (Task 7).

---

## File map

```
photobooth/
├─ index.html                      vite entry (viewport-fit=cover, theme color)
├─ package.json  package-lock.json
├─ vite.config.ts                  react + tailwind + cloudflare plugins
├─ vitest.config.ts                projects: unit (node) + worker (cloudflareTest)
├─ playwright.config.ts            chromium, fake media flags, dev server on :5199
├─ wrangler.jsonc                  dev/deploy config (DO via `exports`, ratelimits, assets)
├─ wrangler.test.jsonc             test-pool config (same bindings, no assets)
├─ eslint.config.mjs
├─ tsconfig.json                   references → client / worker / node
├─ tsconfig.client.json  tsconfig.worker.json  tsconfig.node.json
├─ public/  favicon.svg  _headers
├─ e2e/     helpers.ts connect capture photos join lobby errors a11y  (*.spec.ts)
└─ src/
   ├─ shared/                      imported by worker AND client (no DOM, no Workers APIs)
   │  constants.ts  room-code.ts  protocol.ts  (+ *.test.ts)
   ├─ worker/
   │  index.ts  BoothRoom.ts  ice.ts  env.d.ts  test-helpers.ts  (+ *.test.ts)
   └─ client/
      main.tsx  App.tsx  index.css
      style-rules.test.ts          enforces the no-blur / no-gradient / hard-shadow / ≤8px-radius rules
      pages/       Home CreateBooth JoinBooth Booth      (Booth = all the logic; JoinBooth also exports JoinForm)
      screens/     CameraGate Lobby Stage Result Problem Splash     (presentational)
      components/  BrutalButton BrutalCard BrutalInput BrutalBadge BrutalLabel BrutalDivider
                   BrutalModal BrutalToast BrutalRadioGroup CameraFrame Countdown PhotoStrip
                   RoomCode ConnectionStatus BoothHeader SiteHeader PrivacyNote FilterPicker
      hooks/       useLatest useRoom useRoomGate useCamera useWebRTC useSyncClock useStrip
      lib/         session room-socket camera webrtc sync capture photo photo-transfer rounds
                   strip filters dev-hook   (+ *.test.ts)
```

## Task index

| # | Task | Phase |
|---|---|---|
| 1 | Scaffold: Vite + React + Tailwind + Worker + configs + tooling | 1 |
| 2 | Shared room-code (generate / validate / normalize / format) | 1 |
| 3 | Shared protocol types + strict validators | 1 |
| 4 | `BoothRoom`: record, create/status, join, reclaim, full, leave | 1 |
| 5 | `BoothRoom`: relay, ping/pong, validation, rate limit, expiry, hibernation | 1 |
| 6 | `ice.ts` + Worker routes (create / lookup / ws / ice) | 1 |
| 7 | Client: session id, `RoomSocket`, `useRoom`, `useRoomGate` | 1 |
| 8 | Client: camera lib + `useCamera` | 1 |
| 9 | Client: `Peer` (WebRTC) + `useWebRTC` | 1 |
| 10 | Client: router, pages, plain screens, `Booth` glue | 1 |
| 11 | Playwright setup + e2e "two browsers see each other" | 1 |
| 12 | `BoothRoom`: ready → scheduled capture, photo-complete, timeouts | 2 |
| 13 | Client: `sync.ts` + `useSyncClock` | 2 |
| 14 | Client: capture scheduler + `countdownLabel` | 2 |
| 15 | Booth: ready UI + countdown + dev hook + e2e sync | 2 |
| 16 | `photo.ts`: capture frame, fit, cover-crop, strip geometry | 3 |
| 17 | `photo-transfer.ts` + `rounds.ts` | 3 |
| 18 | Booth: capture → exchange → complete, `cam` mirroring | 3 |
| 19 | `renderStrip` + download + Result screen + e2e photos | 3 |
| 20 | Design tokens + Brutal primitives + toast + modal | 4 |
| 21 | Landing, Create, Join pages (styled) | 4 |
| 22 | Booth screens styled (frames, countdown, lobby, QR, errors) | 4 |
| 23 | Filters + layouts + share + styled Result | 4 |
| 24 | Accessibility, reduced motion, security headers, error/mobile e2e | 4 |
| 25 | README + manual device checklist + final verification | 4 |

## Commands used throughout

```bash
npm run typecheck        # wrangler types && tsc -b
npm run lint             # eslint .
npm test                 # vitest run  (unit + worker projects)
npx vitest run src/shared/room-code.test.ts          # one file
npx vitest run --project worker                      # only Durable Object / Worker tests
npm run test:e2e         # Playwright (starts its own dev server on :5199)
npm run check            # typecheck + lint + test
```
