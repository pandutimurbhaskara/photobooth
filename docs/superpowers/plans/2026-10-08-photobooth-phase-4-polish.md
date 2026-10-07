# Phase 4 — Polish (Tasks 20–25)

> Part of `2026-10-08-photobooth.md`. **Read that master file first**, especially "Look and copy". Spec: §10–§13 and D15.

**Phase goal:** the working product from Phases 1–3 gets its Neo-Brutalist identity, filters, QR/copy/share, error screens, accessibility and security headers, plus the README and a final verification that says plainly what was and was not verified.

**Gate:** `npm run check` and `npm run test:e2e` (all specs) green; `npm run build` succeeds; README and manual checklist written.

**Rules for this phase**
- Presentational files (`screens/*`, `components/*`, `pages/Home|CreateBooth|JoinBooth`, `index.css`) are restyled; **logic stays in `Booth.tsx`, hooks and `lib/`**. Every string the e2e specs rely on is preserved verbatim: `WAITING FOR YOUR PERSON...`, `● CONNECTED`, `BOOTH FULL.`, `NO SUCH BOOTH.`, `YOU READY ✓`, `I'M READY`, `BOTH READY. GET READY.`, `YOU CAPTURED ✓`, `WAITING FOR THE PHOTOS...`, `LOOK WHAT YOU MADE.`, `DOWNLOAD PHOTO`, `RETAKE`, `SHARE`, `THEY LEFT`, layout/format radio names `VERTICAL HORIZONTAL GRID PNG JPG`, `data-testid` values `local-video remote-video countdown`.
- The word "shadow" is only used in the form `shadow-brutal*` / `shadow-press` in client source, and the words "gradient" and "blur" do not appear there at all (a test enforces the style rules, so do not put them even in comments).

---

## Task 20: Design tokens, Brutal primitives, toast, modal

**Files:**
- Modify: `src/client/index.css` (replace), `src/client/App.tsx`
- Create: `src/client/components/{BrutalButton,BrutalCard,BrutalInput,BrutalBadge,BrutalLabel,BrutalDivider,BrutalModal,BrutalToast}.tsx`, `src/client/style-rules.test.ts`

**Interfaces:**
- Produces:
  - `buttonClass(tone?: Tone, size?: 'md' | 'xl'): string`; `BrutalButton({ tone, size, ...button props })`; `type Tone = 'yellow' | 'pink' | 'lime' | 'ink' | 'paper' | 'blue'`
  - `BrutalCard({ tone?: CardTone, heavy?: boolean, ...div props })`
  - `BrutalInput({ label: string, error?: string, ...input props })`
  - `BrutalBadge({ tone?: BadgeTone, ...span props })`; `type BadgeTone = 'lime' | 'yellow' | 'blue' | 'orange' | 'pink' | 'ink' | 'paper'`
  - `BrutalLabel({ tone?, tilt?: 'left' | 'right' | 'none', ...span props })`
  - `BrutalDivider({ words?: string[] })` (decorative, `aria-hidden`)
  - `BrutalModal({ open, onClose, title, children })` — native `<dialog>` (focus trap, Esc, inert backdrop, focus return come from the platform)
  - `ToastProvider`, `useToast(): (text: string) => void`

- [ ] **Step 1: Write the failing style-rules test**

`src/client/style-rules.test.ts`:
```ts
import { describe, expect, it } from 'vitest'

// Every client source file, as text. This test enforces the brief's hard design rules so a stray
// utility class cannot quietly turn the app into a glassy SaaS dashboard.
const files = import.meta.glob('./**/*.{ts,tsx,css}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const sources = Object.entries(files).filter(([path]) => !path.endsWith('.test.ts'))

const RULES: Array<[string, RegExp]> = [
  ['no blur (no glassmorphism)', /backdrop-blur|(?<![\w-])blur-|blur\(/],
  ['no gradients', /gradient/i],
  ['no soft shadows (hard offset shadows only)', /(?<![\w-])(?:drop-)?shadow-(?:xs|sm|md|lg|xl|2xl|inner)(?![\w-])/],
  ['no big or pill radii (8px maximum)', /(?<![\w-])rounded-(?:xl|2xl|3xl|full)(?![\w-])/],
]

describe('neo-brutalist style rules', () => {
  it('actually scans the client source', () => {
    expect(sources.length).toBeGreaterThan(15)
  })
  for (const [name, pattern] of RULES) {
    it(name, () => {
      expect(sources.filter(([, text]) => pattern.test(text)).map(([path]) => path)).toEqual([])
    })
  }
})
```
Run: `npx vitest run src/client/style-rules.test.ts`
Expected: the "actually scans" test FAILS (fewer than 16 files exist yet) — it passes by the end of this task once the new components exist; the four rule tests already pass. Keep going.

- [ ] **Step 2: Tokens and base styles**

`src/client/index.css`:
```css
@import 'tailwindcss';
@import '@fontsource-variable/space-grotesk';

@theme {
  --color-paper: #fff8e7;
  --color-ink: #0a0a0a;
  --color-yellow: #ffe600;
  --color-pink: #ff4fa3;
  --color-blue: #2f5bff;
  --color-lime: #b6ff3b;
  --color-orange: #ff8a1f;
  --color-purple: #8b5cf6;

  --font-display: 'Space Grotesk Variable', ui-sans-serif, system-ui, sans-serif;

  --shadow-brutal: 5px 5px 0 #0a0a0a;
  --shadow-brutal-sm: 3px 3px 0 #0a0a0a;
  --shadow-press: 1px 1px 0 #0a0a0a;

  --animate-pop: pop 180ms steps(4, end) both;
  --animate-wiggle: wiggle 700ms steps(3, end) infinite;

  @keyframes pop {
    from {
      transform: scale(0.5) rotate(-8deg);
    }
    70% {
      transform: scale(1.12) rotate(2deg);
    }
    to {
      transform: scale(1) rotate(0);
    }
  }
  @keyframes wiggle {
    0%,
    100% {
      transform: rotate(-4deg);
    }
    50% {
      transform: rotate(4deg);
    }
  }
}

@layer base {
  html {
    background: var(--color-paper);
    color: var(--color-ink);
    font-family: var(--font-display);
    -webkit-text-size-adjust: 100%;
  }
  body {
    margin: 0;
    min-height: 100dvh;
    padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);
  }
  :focus-visible {
    outline: 3px solid var(--color-ink);
    outline-offset: 3px;
    box-shadow: 0 0 0 6px var(--color-yellow);
  }
  ::selection {
    background: var(--color-yellow);
    color: var(--color-ink);
  }
  button,
  a,
  label {
    touch-action: manipulation;
  }
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

- [ ] **Step 3: The primitives**

`src/client/components/BrutalButton.tsx`:
```tsx
import type { ButtonHTMLAttributes } from 'react'

export type Tone = 'yellow' | 'pink' | 'lime' | 'ink' | 'paper' | 'blue'

const TONE: Record<Tone, string> = {
  yellow: 'bg-yellow text-ink',
  pink: 'bg-pink text-ink',
  lime: 'bg-lime text-ink',
  ink: 'bg-ink text-paper',
  paper: 'bg-paper text-ink',
  blue: 'bg-blue text-white',
}

/** Shared by <button> and router <Link>s so both look and press the same. */
export function buttonClass(tone: Tone = 'yellow', size: 'md' | 'xl' = 'md'): string {
  return [
    'inline-flex items-center justify-center gap-2 border-[3px] border-ink font-black uppercase leading-none tracking-tight shadow-brutal',
    'transition-transform duration-75 active:translate-x-1 active:translate-y-1 active:shadow-press',
    'disabled:pointer-events-none disabled:translate-x-1 disabled:translate-y-1 disabled:opacity-60 disabled:shadow-press',
    size === 'xl' ? 'min-h-16 px-6 py-5 text-2xl sm:text-3xl' : 'min-h-12 px-4 py-3 text-base',
    TONE[tone],
  ].join(' ')
}

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: Tone
  size?: 'md' | 'xl'
}

export function BrutalButton({ tone, size, className = '', type = 'button', ...rest }: Props) {
  return <button type={type} {...rest} className={`${buttonClass(tone, size)} ${className}`} />
}
```

`src/client/components/BrutalCard.tsx`:
```tsx
import type { HTMLAttributes } from 'react'

export type CardTone = 'paper' | 'white' | 'yellow' | 'pink' | 'lime' | 'blue' | 'orange' | 'purple'

const TONE: Record<CardTone, string> = {
  paper: 'bg-paper text-ink',
  white: 'bg-white text-ink',
  yellow: 'bg-yellow text-ink',
  pink: 'bg-pink text-ink',
  lime: 'bg-lime text-ink',
  blue: 'bg-blue text-white',
  orange: 'bg-orange text-ink',
  purple: 'bg-purple text-ink',
}

interface Props extends HTMLAttributes<HTMLDivElement> {
  tone?: CardTone
  /** Key cards get the 4 px border; everything else 3 px. */
  heavy?: boolean
}

export function BrutalCard({ tone = 'paper', heavy = false, className = '', ...rest }: Props) {
  return <div {...rest} className={`${heavy ? 'border-4' : 'border-[3px]'} border-ink shadow-brutal ${TONE[tone]} ${className}`} />
}
```

`src/client/components/BrutalBadge.tsx`:
```tsx
import type { HTMLAttributes } from 'react'

export type BadgeTone = 'lime' | 'yellow' | 'blue' | 'orange' | 'pink' | 'ink' | 'paper'

const TONE: Record<BadgeTone, string> = {
  lime: 'bg-lime text-ink',
  yellow: 'bg-yellow text-ink',
  blue: 'bg-blue text-white',
  orange: 'bg-orange text-ink',
  pink: 'bg-pink text-ink',
  ink: 'bg-ink text-paper',
  paper: 'bg-paper text-ink',
}

export function BrutalBadge({ tone = 'paper', className = '', ...rest }: HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return (
    <span
      {...rest}
      className={`inline-flex items-center gap-2 border-[3px] border-ink px-2 py-1 text-xs font-black uppercase tracking-wider ${TONE[tone]} ${className}`}
    />
  )
}
```

`src/client/components/BrutalLabel.tsx`:
```tsx
import type { HTMLAttributes } from 'react'

const TONE = {
  ink: 'bg-ink text-paper',
  yellow: 'bg-yellow text-ink',
  pink: 'bg-pink text-ink',
  lime: 'bg-lime text-ink',
  paper: 'bg-paper text-ink',
} as const
const TILT = { left: '-rotate-2', right: 'rotate-2', none: '' } as const

interface Props extends HTMLAttributes<HTMLSpanElement> {
  tone?: keyof typeof TONE
  tilt?: keyof typeof TILT
}

/** A small taped-on tag, like a label-maker strip. */
export function BrutalLabel({ tone = 'ink', tilt = 'left', className = '', ...rest }: Props) {
  return (
    <span
      {...rest}
      className={`inline-block border-[3px] border-ink px-2 py-0.5 text-xs font-black uppercase tracking-[0.15em] ${TILT[tilt]} ${TONE[tone]} ${className}`}
    />
  )
}
```

`src/client/components/BrutalDivider.tsx`:
```tsx
const DEFAULT = ['CAPTURE', 'SYNC', 'LIVE', 'REC']

/** A decorative ticker strip. Purely visual, hidden from assistive tech. */
export function BrutalDivider({ words = DEFAULT }: { words?: string[] }) {
  const line = Array.from({ length: 6 }, () => words.join(' ★ ')).join(' ★ ')
  return (
    <div aria-hidden="true" className="overflow-hidden whitespace-nowrap border-y-4 border-ink bg-ink py-2 text-sm font-black uppercase tracking-[0.3em] text-paper">
      {line}
    </div>
  )
}
```

`src/client/components/BrutalInput.tsx`:
```tsx
import { useId, type InputHTMLAttributes } from 'react'

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  label: string
  error?: string | null
}

/** Styled like a label-maker panel: a taped label above a chunky, tracked-out field. */
export function BrutalInput({ label, error, id, className = '', ...rest }: Props) {
  const auto = useId()
  const inputId = id ?? auto
  const errorId = `${inputId}-error`
  return (
    <div className="flex flex-col items-start gap-2">
      <label htmlFor={inputId} className="-rotate-1 border-[3px] border-ink bg-ink px-2 py-0.5 text-xs font-black uppercase tracking-[0.2em] text-paper">
        {label}
      </label>
      <input
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        {...rest}
        className={`block w-full border-4 border-ink bg-white px-4 py-4 text-center text-3xl font-black uppercase tracking-[0.3em] text-ink shadow-brutal placeholder:text-ink/40 sm:text-4xl ${className}`}
      />
      {error && (
        <p id={errorId} role="alert" className="border-[3px] border-ink bg-orange px-2 py-1 text-sm font-black uppercase">
          {error}
        </p>
      )}
    </div>
  )
}
```

`src/client/components/BrutalModal.tsx`:
```tsx
import { useEffect, useId, useRef, type ReactNode } from 'react'

interface Props {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
}

/** Native <dialog>: the platform provides the focus trap, Esc to close, inert background and focus return. */
export function BrutalModal({ open, onClose, title, children }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    else if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose() // a click on the backdrop
      }}
      className="m-auto w-[min(92vw,26rem)] border-4 border-ink bg-paper p-0 text-ink shadow-brutal backdrop:bg-ink/80"
    >
      <div className="flex items-center justify-between gap-3 border-b-4 border-ink bg-yellow px-4 py-2">
        <h2 id={titleId} className="text-lg font-black uppercase">
          {title}
        </h2>
        <button type="button" onClick={onClose} aria-label="Close" className="min-h-10 min-w-10 border-[3px] border-ink bg-paper font-black">
          ✕
        </button>
      </div>
      <div className="p-4">{children}</div>
    </dialog>
  )
}
```

`src/client/components/BrutalToast.tsx`:
```tsx
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'

interface Toast {
  id: number
  text: string
}

const ToastContext = createContext<(text: string) => void>(() => {})
export const useToast = (): ((text: string) => void) => useContext(ToastContext)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(1)

  const push = useCallback((text: string) => {
    const id = nextId.current++
    setToasts((all) => [...all.slice(-2), { id, text }])
    setTimeout(() => setToasts((all) => all.filter((t) => t.id !== id)), 2600)
  }, [])

  return (
    <ToastContext value={push}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]"
      >
        {toasts.map((t) => (
          <p key={t.id} className="animate-pop border-4 border-ink bg-yellow px-4 py-2 text-sm font-black uppercase text-ink shadow-brutal">
            {t.text}
          </p>
        ))}
      </div>
    </ToastContext>
  )
}
```

`src/client/App.tsx` — wrap the router:
```tsx
import { BrowserRouter, Route, Routes } from 'react-router'
import { ToastProvider } from './components/BrutalToast'
import { Booth } from './pages/Booth'
import { CreateBooth } from './pages/CreateBooth'
import { Home } from './pages/Home'
import { JoinBooth } from './pages/JoinBooth'

export function App() {
  return (
    <ToastProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/create" element={<CreateBooth />} />
          <Route path="/join" element={<JoinBooth />} />
          <Route path="/b/:code" element={<Booth />} />
          <Route path="*" element={<Home />} />
        </Routes>
      </BrowserRouter>
    </ToastProvider>
  )
}
```

- [ ] **Step 4: Verify and commit**

Run: `npm run typecheck && npm run lint && npm test`
Expected: green. The style-rules "actually scans" check passes now (> 15 source files). If a rule test lists a file, remove the offending class — do not weaken the regex.
Eyeball: `npm run dev -- --port 5199 --strictPort`, open `/` — the page background is cream and the base font is Space Grotesk (the rest of the page is still plain until Task 21).
```bash
git add src/client
git commit -m "feat: add neo-brutalist tokens, primitives, toast and modal"
```

---

## Task 21: Landing, Create and Join pages

**Files:**
- Create: `src/client/components/{SiteHeader,PrivacyNote}.tsx`
- Modify: `src/client/pages/{Home,CreateBooth,JoinBooth}.tsx`
- Create: `e2e/join.spec.ts`

**Interfaces:**
- Consumes: Task 20 primitives; `JoinForm` contract from Task 10 (`export function JoinForm()`, label `ENTER CODE`, submit button `JOIN`, error strings unchanged).
- Produces: `SiteHeader()`, `PrivacyNote()`.

- [ ] **Step 1: Write the failing e2e** (Review Focus 5, through the real form)

`e2e/join.spec.ts`:
```ts
import { expect, test } from '@playwright/test'
import { createBooth, enterBooth, newPlayer } from './helpers'

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
```
Run: `npm run test:e2e -- join.spec.ts` → this already passes against the plain Phase 1 form (the logic is unchanged); it is the regression net for the restyle. Keep it green through the rest of this task.

- [ ] **Step 2: Shared bits**

`src/client/components/SiteHeader.tsx`:
```tsx
import { Link } from 'react-router'
import { APP_NAME } from '../../shared/constants'
import { buttonClass } from './BrutalButton'

export function SiteHeader() {
  return (
    <header className="flex items-center justify-between gap-3 border-b-4 border-ink bg-paper px-4 py-3">
      <Link to="/" className="text-2xl font-black tracking-tighter">
        {APP_NAME} <span aria-hidden="true">★</span>
      </Link>
      <nav aria-label="Primary" className="flex items-center gap-4 text-sm font-black uppercase">
        <a href="#how" className="hidden underline decoration-4 underline-offset-4 sm:inline">
          How it works
        </a>
        <Link to="/create" className={buttonClass('yellow')}>
          Create
        </Link>
      </nav>
    </header>
  )
}
```

`src/client/components/PrivacyNote.tsx` (text is brief §32, verbatim):
```tsx
export function PrivacyNote({ className = '' }: { className?: string }) {
  return (
    <p className={`border-[3px] border-ink bg-paper p-3 text-xs font-black uppercase leading-snug sm:text-sm ${className}`}>
      YOUR CAMERA STAYS IN YOUR BROWSER AND CONNECTS DIRECTLY TO YOUR PARTNER WHEN POSSIBLE. PHOTOS ARE PROCESSED
      LOCALLY UNLESS YOU CHOOSE TO SAVE OR SHARE THEM.
    </p>
  )
}
```

- [ ] **Step 3: Join page (restyle; logic unchanged)**

`src/client/pages/JoinBooth.tsx`:
```tsx
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { normalizeRoomInput } from '../../shared/room-code'
import { BrutalButton } from '../components/BrutalButton'
import { BrutalCard } from '../components/BrutalCard'
import { BrutalInput } from '../components/BrutalInput'
import { SiteHeader } from '../components/SiteHeader'
import { getParticipantId } from '../lib/session'

export function JoinForm() {
  const navigate = useNavigate()
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const code = normalizeRoomInput(value)
    if (!code) {
      setError('THAT CODE LOOKS WRONG.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/rooms/${code}`, { headers: { 'x-participant-id': getParticipantId(code) } })
      if (res.status === 404) setError('NO BOOTH WITH THAT CODE.')
      else if (!res.ok) setError('COULD NOT CHECK THAT BOOTH. TRY AGAIN.')
      else if (((await res.json()) as { full: boolean }).full) setError('BOOTH FULL.')
      else void navigate(`/b/${code}`)
    } catch {
      setError('COULD NOT REACH THE SERVER.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
      <BrutalInput
        label="ENTER CODE"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        error={error}
        placeholder="A7K 9XM"
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        inputMode="text"
      />
      <BrutalButton type="submit" tone="ink" size="xl" disabled={busy}>
        JOIN
      </BrutalButton>
    </form>
  )
}

export function JoinBooth() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex max-w-xl flex-col gap-6 p-4 pt-10">
        <BrutalCard tone="lime" heavy className="flex flex-col gap-5 p-5">
          <h1 className="text-4xl font-black uppercase leading-none">JOIN A BOOTH</h1>
          <JoinForm />
        </BrutalCard>
      </main>
    </>
  )
}
```

- [ ] **Step 4: Create page**

`src/client/pages/CreateBooth.tsx`:
```tsx
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { BrutalButton } from '../components/BrutalButton'
import { BrutalCard } from '../components/BrutalCard'
import { SiteHeader } from '../components/SiteHeader'

export function CreateBooth() {
  const navigate = useNavigate()
  const [failed, setFailed] = useState(false)
  const started = useRef(false)

  const create = useCallback(async () => {
    setFailed(false)
    try {
      const res = await fetch('/api/rooms', { method: 'POST' })
      if (!res.ok) throw new Error(String(res.status))
      const { code } = (await res.json()) as { code: string }
      void navigate(`/b/${code}`, { replace: true })
    } catch {
      setFailed(true)
    }
  }, [navigate])

  useEffect(() => {
    if (started.current) return // StrictMode runs effects twice in dev; make one room, not two
    started.current = true
    void create()
  }, [create])

  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex max-w-xl flex-col gap-6 p-4 pt-10">
        <BrutalCard tone={failed ? 'orange' : 'yellow'} heavy className="flex flex-col gap-4 p-6" role={failed ? 'alert' : 'status'}>
          {failed ? (
            <>
              <h1 className="text-4xl font-black uppercase leading-none">COULDN'T BUILD YOUR BOOTH.</h1>
              <BrutalButton tone="ink" onClick={() => void create()}>
                TRY AGAIN
              </BrutalButton>
            </>
          ) : (
            <h1 className="flex items-center gap-3 text-4xl font-black uppercase leading-none">
              <span aria-hidden="true" className="inline-block animate-wiggle text-5xl">
                ★
              </span>
              BUILDING YOUR BOOTH…
            </h1>
          )}
        </BrutalCard>
      </main>
    </>
  )
}
```

- [ ] **Step 5: Landing page**

`src/client/pages/Home.tsx`:
```tsx
import { Link } from 'react-router'
import { BrutalButton, buttonClass } from '../components/BrutalButton'
import { BrutalCard } from '../components/BrutalCard'
import { BrutalDivider } from '../components/BrutalDivider'
import { BrutalLabel } from '../components/BrutalLabel'
import { PrivacyNote } from '../components/PrivacyNote'
import { SiteHeader } from '../components/SiteHeader'
import { JoinForm } from './JoinBooth'

/** A flat, faceless portrait: stands in for a photo without shipping anyone's picture. */
function SamplePortrait({ bg, skin, hair, shirt }: { bg: string; skin: string; hair: string; shirt: string }) {
  return (
    <svg viewBox="0 0 120 90" aria-hidden="true" preserveAspectRatio="xMidYMid slice" className="block h-full w-full">
      <rect width="120" height="90" fill={bg} />
      <path d="M8 90C8 66 34 60 60 60s52 6 52 30z" fill={shirt} stroke="#0a0a0a" strokeWidth="3" />
      <rect x="52" y="50" width="16" height="14" fill={skin} stroke="#0a0a0a" strokeWidth="3" />
      <circle cx="60" cy="38" r="21" fill={skin} stroke="#0a0a0a" strokeWidth="3" />
      <path d="M38 36C38 14 82 14 82 36C74 26 46 26 38 36z" fill={hair} stroke="#0a0a0a" strokeWidth="3" strokeLinejoin="round" />
      <circle cx="52" cy="41" r="2.4" fill="#0a0a0a" />
      <circle cx="68" cy="41" r="2.4" fill="#0a0a0a" />
      <path d="M53 49q7 6 14 0" fill="none" stroke="#0a0a0a" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  )
}

const STEPS = [
  { n: '01', title: 'CREATE', text: 'MAKE A BOOTH. GET A SIX-LETTER CODE.' },
  { n: '02', title: 'SHARE', text: 'SEND THE LINK OR THE QR TO YOUR PERSON.' },
  { n: '03', title: 'SNAP', text: 'BOTH PRESS READY. 3-2-1. ONE SHOT, SAME INSTANT.' },
]

export function Home() {
  return (
    <>
      <SiteHeader />
      <main>
        <section className="relative overflow-hidden px-4 pb-12 pt-10 sm:px-8">
          <span aria-hidden="true" className="absolute right-4 top-6 hidden rotate-12 text-7xl font-black sm:block">
            ✦
          </span>
          <span aria-hidden="true" className="absolute bottom-20 right-8 hidden -rotate-6 border-4 border-ink bg-pink px-3 py-1 text-3xl font-black sm:block">
            !
          </span>
          <h1 className="font-black uppercase leading-[0.85] tracking-tighter text-[clamp(3.25rem,15vw,10rem)]">
            <span className="block">Make</span>
            <span className="block">Something</span>
            <span className="inline-block -rotate-1 border-4 border-ink bg-yellow px-3 shadow-brutal">Worth</span>
            <span className="block">Keeping.</span>
          </h1>
          <p className="mt-6 max-w-xl text-xl font-black uppercase leading-tight sm:text-2xl">
            A TWO-PERSON PHOTO BOOTH
            <br />
            FOR PEOPLE WHO AREN'T
            <br />
            IN THE SAME PLACE.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-4">
            <Link to="/create" className={buttonClass('yellow', 'xl')}>
              CREATE A BOOTH →
            </Link>
            <a href="#join" className={buttonClass('paper', 'xl')}>
              JOIN A BOOTH
            </a>
          </div>
        </section>

        <BrutalDivider />

        <section aria-label="Sample photos" className="grid gap-8 border-b-4 border-ink bg-pink p-6 sm:grid-cols-2 sm:p-10">
          {[
            { bg: '#ffe600', skin: '#f2c7a0', hair: '#0a0a0a', shirt: '#2f5bff', label: 'YOU', n: '01' },
            { bg: '#b6ff3b', skin: '#a8714a', hair: '#7a3b12', shirt: '#ff8a1f', label: 'THEM', n: '02' },
          ].map((p) => (
            <figure key={p.n} className="relative">
              <div className="aspect-[4/3] overflow-hidden border-4 border-ink bg-ink shadow-brutal">
                <SamplePortrait bg={p.bg} skin={p.skin} hair={p.hair} shirt={p.shirt} />
              </div>
              <figcaption className="absolute -top-3 left-3 flex gap-2">
                <BrutalLabel tone="ink">{p.label}</BrutalLabel>
                <BrutalLabel tone="paper" tilt="right">
                  {p.n}
                </BrutalLabel>
              </figcaption>
            </figure>
          ))}
        </section>

        <section id="join" className="px-4 py-12 sm:px-8">
          <BrutalCard tone="lime" heavy className="mx-auto flex max-w-xl flex-col gap-5 p-5">
            <h2 className="text-4xl font-black uppercase leading-none">JOIN A BOOTH</h2>
            <JoinForm />
          </BrutalCard>
        </section>

        <section id="how" className="border-y-4 border-ink bg-yellow px-4 py-12 sm:px-8">
          <h2 className="mb-6 text-4xl font-black uppercase leading-none">HOW IT WORKS</h2>
          <ol className="grid gap-6 sm:grid-cols-3">
            {STEPS.map((s) => (
              <li key={s.n}>
                <BrutalCard heavy className="h-full p-5">
                  <p aria-hidden="true" className="text-6xl font-black leading-none">
                    {s.n}
                  </p>
                  <h3 className="mt-2 text-2xl font-black uppercase">{s.title}</h3>
                  <p className="mt-1 font-bold uppercase leading-snug">{s.text}</p>
                </BrutalCard>
              </li>
            ))}
          </ol>
        </section>

        <section className="px-4 py-10 sm:px-8">
          <PrivacyNote className="mx-auto max-w-2xl" />
        </section>
      </main>
      <footer className="border-t-4 border-ink bg-ink px-4 py-6 text-center text-sm font-black uppercase tracking-widest text-paper">
        <BrutalButton tone="yellow" onClick={() => window.scrollTo({ top: 0 })}>
          BACK TO TOP ↑
        </BrutalButton>
      </footer>
    </>
  )
}
```

- [ ] **Step 6: Verify and commit**

Run: `npm run typecheck && npm run lint && npm test && npm run test:e2e -- join.spec.ts connect.spec.ts`
Expected: green. Look at `/`, `/join`, `/create` at 390 px and 1280 px wide (browser devtools): no horizontal scroll, hero legible, focus ring visible when tabbing.
```bash
git add src/client e2e/join.spec.ts
git commit -m "feat: add landing, create and join pages in the brutalist style"
```

---

## Task 22: Booth screens — frames, countdown, lobby with QR, errors

**Files:**
- Create: `src/client/components/{ConnectionStatus,RoomCode,BoothHeader}.tsx`, `src/client/screens/Splash.tsx`, `e2e/lobby.spec.ts`
- Modify (full replacement): `src/client/components/{CameraFrame,Countdown}.tsx`, `src/client/screens/{CameraGate,Lobby,Stage,Problem}.tsx`
- Modify: `src/client/pages/Booth.tsx`, `e2e/helpers.ts`

**Interfaces:**
- Consumes: Tasks 20–21; `formatRoomCode`; `qrcode`'s `toDataURL`.
- Produces:
  - `type ConnKind = 'connected' | 'camera-ready' | 'waiting' | 'connecting' | 'reconnecting' | 'lost'`; `ConnectionStatus({ kind })`
  - `RoomCode({ code })`; `BoothHeader({ code, status: ConnKind, hasPhotos: boolean })` (EXIT asks first when `hasPhotos`)
  - `CameraFrame({ stream, label, mirrored, testId, videoRef?, accent?: 'pink' | 'blue' | 'lime' | 'yellow', children? })`
  - `Countdown` (same props as before, now an overlay: `absolute inset-0`; place inside a `relative` parent)
  - `Splash({ text })`; `Lobby({ code, shareUrl, stream, mirrored, canFlip, onFlip })`; `CameraGate({ onStart })`
  - `Stage` props gain `code`, `status: ConnKind`, `hasPhotos`, `canFlip`, `onFlip`

- [ ] **Step 1: Write the failing e2e for the lobby** (copy link, QR)

First add clipboard permissions in `e2e/helpers.ts` — change the `permissions` line in `newPlayer` to:
```ts
  const context = await browser.newContext({ baseURL: BASE, permissions: ['camera', 'clipboard-read', 'clipboard-write'], ...opts })
```
`e2e/lobby.spec.ts`:
```ts
import { expect, test } from '@playwright/test'
import { createBooth, enterBooth, newPlayer } from './helpers'

test('the lobby shows the code, copies the link and shows a QR code', async ({ browser }) => {
  const a = await newPlayer(browser)
  const url = await createBooth(a)
  await enterBooth(a)
  const code = url.split('/b/')[1] ?? ''

  await expect(a.getByText('WAITING FOR YOUR PERSON...')).toBeVisible()
  await expect(a.getByText(`Room code ${code.split('').join(' ')}`)).toBeAttached() // spoken form for screen readers
  await expect(a.getByText(`${code.slice(0, 3)} ${code.slice(3)}`, { exact: true })).toBeVisible() // 3 + 3 on screen

  await a.getByRole('button', { name: 'COPY LINK' }).click()
  await expect(a.getByText('LINK COPIED')).toBeVisible()
  expect(await a.evaluate(() => navigator.clipboard.readText())).toBe(url)

  await a.getByRole('button', { name: 'QR CODE' }).click()
  const dialog = a.getByRole('dialog')
  await expect(dialog).toBeVisible()
  const qr = dialog.getByRole('img', { name: 'QR code for this booth' })
  await expect(qr).toBeVisible()
  expect(await qr.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(100)
  await a.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
})

test('the camera gate carries the privacy copy', async ({ browser }) => {
  const a = await newPlayer(browser)
  await createBooth(a)
  await expect(a.getByText(/YOUR CAMERA STAYS IN YOUR BROWSER/)).toBeVisible()
  await expect(a.getByText(/PHOTOS ARE PROCESSED\s+LOCALLY UNLESS YOU CHOOSE TO SAVE OR SHARE THEM/)).toBeVisible()
})
```

- [ ] **Step 2: Small components**

`src/client/components/ConnectionStatus.tsx`:
```tsx
import { BrutalBadge, type BadgeTone } from './BrutalBadge'

export type ConnKind = 'connected' | 'camera-ready' | 'waiting' | 'connecting' | 'reconnecting' | 'lost'

const MAP: Record<ConnKind, { glyph: string; text: string; tone: BadgeTone }> = {
  connected: { glyph: '●', text: 'CONNECTED', tone: 'lime' },
  'camera-ready': { glyph: '●', text: 'CAMERA READY', tone: 'yellow' },
  waiting: { glyph: '●', text: 'WAITING FOR THEM', tone: 'blue' },
  connecting: { glyph: '●', text: 'CONNECTING', tone: 'paper' },
  reconnecting: { glyph: '●', text: 'RECONNECTING', tone: 'orange' },
  lost: { glyph: '!', text: 'CONNECTION LOST', tone: 'orange' },
}

export function ConnectionStatus({ kind }: { kind: ConnKind }) {
  const m = MAP[kind]
  return (
    <BrutalBadge tone={m.tone} role="status">
      <span aria-hidden="true">{m.glyph}</span> {m.text}
    </BrutalBadge>
  )
}
```

`src/client/components/RoomCode.tsx`:
```tsx
import { formatRoomCode } from '../../shared/room-code'

export function RoomCode({ code }: { code: string }) {
  return (
    <p className="border-4 border-ink bg-white px-4 py-3 text-center font-black leading-none tracking-[0.12em] shadow-brutal text-[clamp(3.25rem,17vw,7.5rem)]">
      <span className="sr-only">Room code {code.split('').join(' ')}</span>
      <span aria-hidden="true">{formatRoomCode(code)}</span>
    </p>
  )
}
```

`src/client/components/BoothHeader.tsx`:
```tsx
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { formatRoomCode } from '../../shared/room-code'
import { BrutalButton } from './BrutalButton'
import { BrutalModal } from './BrutalModal'
import { ConnectionStatus, type ConnKind } from './ConnectionStatus'

interface Props {
  code: string
  status: ConnKind
  /** Photos live only in this tab; leaving without saving loses them, so EXIT asks first. */
  hasPhotos: boolean
}

export function BoothHeader({ code, status, hasPhotos }: Props) {
  const navigate = useNavigate()
  const [confirming, setConfirming] = useState(false)
  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-2 border-4 border-ink bg-paper px-3 py-2 shadow-brutal">
        <p className="text-lg font-black uppercase tracking-tight">BOOTH {formatRoomCode(code)}</p>
        <ConnectionStatus kind={status} />
        <BrutalButton tone="paper" onClick={() => (hasPhotos ? setConfirming(true) : void navigate('/'))}>
          EXIT
        </BrutalButton>
      </header>
      <BrutalModal open={confirming} onClose={() => setConfirming(false)} title="Leave the booth?">
        <p className="font-black uppercase leading-snug">YOUR PHOTOS LIVE ONLY IN THIS TAB. DOWNLOAD THE STRIP FIRST.</p>
        <div className="mt-4 flex flex-wrap gap-3">
          <BrutalButton tone="lime" onClick={() => setConfirming(false)}>
            STAY
          </BrutalButton>
          <BrutalButton tone="pink" onClick={() => void navigate('/')}>
            LEAVE ANYWAY
          </BrutalButton>
        </div>
      </BrutalModal>
    </>
  )
}
```

`src/client/screens/Splash.tsx`:
```tsx
export function Splash({ text }: { text: string }) {
  return (
    <main className="grid min-h-dvh place-items-center p-6" role="status">
      <p className="flex items-center gap-3 border-4 border-ink bg-yellow px-5 py-4 text-2xl font-black uppercase shadow-brutal">
        <span aria-hidden="true" className="inline-block animate-wiggle">
          ★
        </span>
        {text}
      </p>
    </main>
  )
}
```

- [ ] **Step 3: Camera frame and countdown (full replacements)**

`src/client/components/CameraFrame.tsx`:
```tsx
import { useEffect, useRef, type ReactNode, type RefObject } from 'react'
import { BrutalLabel } from './BrutalLabel'

const ACCENT = { pink: 'bg-pink', blue: 'bg-blue', lime: 'bg-lime', yellow: 'bg-yellow' } as const

interface Props {
  stream: MediaStream | null
  label: string
  mirrored: boolean
  testId: string
  videoRef?: RefObject<HTMLVideoElement | null>
  accent?: keyof typeof ACCENT
  children?: ReactNode
}

/** A live camera as a printed photo: coloured backing, thick frame, taped-on tags. No glass, nothing over the picture but what you add. */
export function CameraFrame({ stream, label, mirrored, testId, videoRef, accent = 'yellow', children }: Props) {
  const own = useRef<HTMLVideoElement>(null)
  const ref = videoRef ?? own
  useEffect(() => {
    const video = ref.current
    if (!video) return
    video.srcObject = stream
    if (stream) void video.play().catch(() => {})
  }, [stream, ref])

  return (
    <div className={`relative border-4 border-ink p-3 pt-5 shadow-brutal ${ACCENT[accent]}`}>
      <div className="absolute -top-3 left-3 flex items-center gap-2">
        <BrutalLabel tone="ink">{label}</BrutalLabel>
        <BrutalLabel tone="paper" tilt="right" aria-hidden="true">
          CAM
        </BrutalLabel>
      </div>
      <span aria-hidden="true" className="absolute -top-3 right-3 border-[3px] border-ink bg-orange px-2 py-0.5 text-xs font-black">
        ● REC
      </span>
      <figure className="relative aspect-[4/3] w-full overflow-hidden border-4 border-ink bg-ink">
        <video
          ref={ref}
          data-testid={testId}
          aria-label={`${label} camera`}
          autoPlay
          muted
          playsInline
          className="h-full w-full object-cover"
          style={{ transform: mirrored ? 'scaleX(-1)' : undefined }}
        />
        {children}
      </figure>
    </div>
  )
}
```

`src/client/components/Countdown.tsx`:
```tsx
import { useEffect, useState } from 'react'
import { countdownLabel, type CountdownLabel } from '../lib/capture'

interface Props {
  captureAt: number
  now: () => number
  onDone: () => void
}

const SHOW_SNAP_MS = 1200

/** Overlay for a `relative` parent. The numerals are derived from the shared timestamp; the capture does not wait for them. */
export function Countdown({ captureAt, now, onDone }: Props) {
  const [label, setLabel] = useState<CountdownLabel>(() => countdownLabel(captureAt - now()))

  useEffect(() => {
    let raf = 0
    const tick = () => {
      const remaining = captureAt - now()
      if (remaining < -SHOW_SNAP_MS) {
        onDone()
        return
      }
      setLabel(countdownLabel(remaining))
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [captureAt, now, onDone])

  return (
    <div data-testid="countdown" role="status" aria-live="assertive" className="pointer-events-none absolute inset-0 z-10 grid place-items-center">
      {label === 'get-ready' ? (
        <p key="get-ready" className="animate-pop border-4 border-ink bg-lime px-5 py-3 text-center text-2xl font-black uppercase shadow-brutal sm:text-4xl">
          BOTH READY. GET READY.
        </p>
      ) : (
        <p
          key={String(label)}
          className={`animate-pop select-none font-black leading-none text-yellow [-webkit-text-stroke:8px_#0a0a0a] [paint-order:stroke_fill] ${
            label === 'snap' ? 'text-[clamp(5rem,24vw,13rem)]' : 'text-[clamp(7rem,38vw,20rem)]'
          }`}
        >
          {label === 'snap' ? 'SNAP!' : label}
        </p>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Screens (full replacements)**

`src/client/screens/CameraGate.tsx`:
```tsx
import { BrutalButton } from '../components/BrutalButton'
import { BrutalCard } from '../components/BrutalCard'
import { PrivacyNote } from '../components/PrivacyNote'

export function CameraGate({ onStart }: { onStart: () => void }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-5 p-4">
      <BrutalCard tone="yellow" heavy className="flex flex-col gap-5 p-6">
        <p aria-hidden="true" className="text-sm font-black tracking-[0.3em]">
          01 / CAMERA
        </p>
        <h1 className="text-5xl font-black uppercase leading-[0.9] tracking-tighter">READY WHEN YOU ARE.</h1>
        <BrutalButton tone="ink" size="xl" onClick={onStart}>
          TURN ON CAMERA
        </BrutalButton>
      </BrutalCard>
      <PrivacyNote />
    </main>
  )
}
```

`src/client/screens/Problem.tsx` (copy map unchanged from Task 10; only the markup changes):
```tsx
import { Link } from 'react-router'
import { buttonClass } from '../components/BrutalButton'
import { BrutalCard } from '../components/BrutalCard'

export type ProblemKind =
  | 'camera-blocked'
  | 'camera-unavailable'
  | 'camera-unsupported'
  | 'room-full'
  | 'not-found'
  | 'expired'
  | 'replaced'
  | 'connection-lost'
  | 'webrtc-failed'
  | 'gate-error'

type Action = { label: string; kind: 'retry' } | { label: string; kind: 'link'; to: string }

const COPY: Record<ProblemKind, { title: string; body: string; action: Action }> = {
  'camera-blocked': { title: 'CAMERA BLOCKED', body: 'WE NEED CAMERA ACCESS TO USE THE BOOTH.', action: { label: 'TRY AGAIN', kind: 'retry' } },
  'camera-unavailable': { title: 'NO CAMERA FOUND', body: 'PLUG ONE IN, OR CLOSE OTHER APPS USING IT.', action: { label: 'TRY AGAIN', kind: 'retry' } },
  'camera-unsupported': { title: 'CAMERA NEEDS HTTPS', body: 'OPEN THIS PAGE OVER A SECURE (HTTPS) CONNECTION.', action: { label: 'EXIT', kind: 'link', to: '/' } },
  'room-full': { title: 'BOOTH FULL.', body: 'THIS BOOTH ALREADY HAS TWO PEOPLE.', action: { label: 'CREATE NEW BOOTH', kind: 'link', to: '/create' } },
  'not-found': { title: 'NO SUCH BOOTH.', body: "THAT CODE DOESN'T MATCH A BOOTH. IT MAY HAVE EXPIRED.", action: { label: 'CREATE NEW BOOTH', kind: 'link', to: '/create' } },
  expired: { title: 'BOOTH CLOSED.', body: 'THIS BOOTH WAS IDLE FOR AN HOUR.', action: { label: 'CREATE NEW BOOTH', kind: 'link', to: '/create' } },
  replaced: { title: 'OPENED ELSEWHERE.', body: 'THIS BOOTH IS OPEN IN ANOTHER TAB.', action: { label: 'EXIT', kind: 'link', to: '/' } },
  'connection-lost': { title: '! CONNECTION LOST', body: "WE COULDN'T REACH THE BOOTH.", action: { label: 'RECONNECT', kind: 'retry' } },
  'webrtc-failed': { title: 'CAMERA CONNECTION FAILED.', body: 'CHECK YOUR NETWORK AND TRY AGAIN.', action: { label: 'RECONNECT', kind: 'retry' } },
  'gate-error': { title: 'SOMETHING BROKE.', body: "WE COULDN'T CHECK THIS BOOTH.", action: { label: 'TRY AGAIN', kind: 'retry' } },
}

interface Props {
  kind: ProblemKind
  onRetry?: () => void
}

export function Problem({ kind, onRetry }: Props) {
  const { title, body, action } = COPY[kind]
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center p-4" role="alert">
      <BrutalCard tone="orange" heavy className="relative flex flex-col gap-4 p-6">
        <span aria-hidden="true" className="absolute -right-3 -top-5 rotate-6 border-4 border-ink bg-yellow px-3 text-4xl font-black">
          !
        </span>
        <h1 className="text-4xl font-black uppercase leading-[0.95]">{title}</h1>
        <p className="text-lg font-black uppercase leading-snug">{body}</p>
        {action.kind === 'retry' ? (
          <button type="button" onClick={onRetry} className={buttonClass('ink', 'xl')}>
            {action.label}
          </button>
        ) : (
          <Link to={action.to} className={buttonClass('ink', 'xl')}>
            {action.label}
          </Link>
        )}
      </BrutalCard>
    </main>
  )
}
```

`src/client/screens/Lobby.tsx`:
```tsx
import QRCode from 'qrcode'
import { useEffect, useState } from 'react'
import { BoothHeader } from '../components/BoothHeader'
import { BrutalBadge } from '../components/BrutalBadge'
import { BrutalButton } from '../components/BrutalButton'
import { BrutalCard } from '../components/BrutalCard'
import { BrutalModal } from '../components/BrutalModal'
import { useToast } from '../components/BrutalToast'
import { CameraFrame } from '../components/CameraFrame'
import type { ConnKind } from '../components/ConnectionStatus'
import { RoomCode } from '../components/RoomCode'

interface Props {
  code: string
  shareUrl: string
  status: ConnKind
  hasPhotos: boolean
  stream: MediaStream | null
  mirrored: boolean
  canFlip: boolean
  onFlip: () => void
  /** True when someone was here and has gone: shows the brief's THEY LEFT :( copy above the wait message. */
  partnerLeft: boolean
}

export function Lobby({ code, shareUrl, status, hasPhotos, stream, mirrored, canFlip, onFlip, partnerLeft }: Props) {
  const toast = useToast()
  const [qrOpen, setQrOpen] = useState(false)
  const [qr, setQr] = useState<string | null>(null)

  useEffect(() => {
    if (!qrOpen || qr) return
    void QRCode.toDataURL(shareUrl, { margin: 1, width: 360, color: { dark: '#0a0a0a', light: '#ffffff' } }).then(setQr)
  }, [qrOpen, qr, shareUrl])

  async function copy() {
    try {
      await navigator.clipboard.writeText(shareUrl)
      toast('LINK COPIED')
    } catch {
      toast('COPY FAILED. SELECT THE LINK.')
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-5 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
      <BoothHeader code={code} status={status} hasPhotos={hasPhotos} />
      <BrutalCard tone="lime" heavy className="flex flex-col gap-4 p-5">
        <h1 className="text-xl font-black uppercase">YOUR BOOTH</h1>
        <RoomCode code={code} />
        <p className="text-sm font-black uppercase tracking-widest">SHARE THIS CODE</p>
        <input
          readOnly
          value={shareUrl}
          aria-label="Booth link"
          onFocus={(e) => e.currentTarget.select()}
          className="w-full border-[3px] border-ink bg-white px-3 py-3 text-sm font-bold"
        />
        <div className="flex flex-wrap gap-3">
          <BrutalButton tone="yellow" onClick={() => void copy()}>
            COPY LINK
          </BrutalButton>
          <BrutalButton tone="paper" onClick={() => setQrOpen(true)}>
            QR CODE
          </BrutalButton>
        </div>
        {partnerLeft && (
          <BrutalCard tone="orange" className="p-3" role="status">
            <p className="text-2xl font-black uppercase leading-none">THEY LEFT :(</p>
            <p className="font-black uppercase">WAITING FOR THEM TO COME BACK.</p>
          </BrutalCard>
        )}
        <p className="animate-pop text-2xl font-black uppercase leading-tight">WAITING FOR YOUR PERSON...</p>
        <div className="flex gap-2">
          <BrutalBadge tone="lime">● YOU</BrutalBadge>
          <BrutalBadge tone="paper">○ THEM</BrutalBadge>
        </div>
      </BrutalCard>

      <CameraFrame stream={stream} label="YOU" mirrored={mirrored} testId="local-video" accent="pink" />
      {canFlip && (
        <BrutalButton tone="paper" onClick={onFlip}>
          FLIP CAMERA
        </BrutalButton>
      )}

      <BrutalModal open={qrOpen} onClose={() => setQrOpen(false)} title="Scan to join">
        {qr ? (
          <img src={qr} alt="QR code for this booth" className="mx-auto block w-full max-w-72 border-4 border-ink" />
        ) : (
          <p className="font-black uppercase">DRAWING...</p>
        )}
      </BrutalModal>
    </main>
  )
}
```

`src/client/screens/Stage.tsx`:
```tsx
import type { RefObject } from 'react'
import type { PState } from '../../shared/protocol'
import { BoothHeader } from '../components/BoothHeader'
import { BrutalBadge } from '../components/BrutalBadge'
import { BrutalButton } from '../components/BrutalButton'
import { BrutalCard } from '../components/BrutalCard'
import { CameraFrame } from '../components/CameraFrame'
import type { ConnKind } from '../components/ConnectionStatus'
import { Countdown } from '../components/Countdown'

interface Props {
  code: string
  status: ConnKind
  hasPhotos: boolean
  stream: MediaStream | null
  mirrored: boolean
  remoteStream: MediaStream | null
  remoteMirrored: boolean
  localVideoRef: RefObject<HTMLVideoElement | null>
  me: PState | null
  partner: PState | null
  canReady: boolean
  onReady: (ready: boolean) => void
  countdown: { captureAt: number } | null
  now: () => number
  onCountdownDone: () => void
  missed: boolean
  exchanging: boolean
  captured: boolean
  canFlip: boolean
  onFlip: () => void
}

export function Stage(p: Props) {
  const iAmReady = p.me?.ready ?? false
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col gap-5 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
      <BoothHeader code={p.code} status={p.status} hasPhotos={p.hasPhotos} />

      <div className="relative">
        <div className="grid gap-6 md:grid-cols-2">
          <div className="md:order-2">
            <CameraFrame stream={p.remoteStream} label="THEM" mirrored={p.remoteMirrored} testId="remote-video" accent="blue" />
          </div>
          <div className="md:order-1">
            <CameraFrame stream={p.stream} label="YOU" mirrored={p.mirrored} testId="local-video" videoRef={p.localVideoRef} accent="pink" />
          </div>
        </div>
        {p.countdown && <Countdown captureAt={p.countdown.captureAt} now={p.now} onDone={p.onCountdownDone} />}
      </div>

      {p.missed && (
        <BrutalCard tone="orange" role="alert" className="p-3 text-lg font-black uppercase">
          MISSED IT. TRY AGAIN IN A MOMENT.
        </BrutalCard>
      )}

      {p.countdown ? (
        <BrutalCard tone="yellow" heavy className="p-4 text-center text-2xl font-black uppercase">
          HOLD STILL. THIS ONE'S GOOD.
        </BrutalCard>
      ) : p.exchanging ? (
        <BrutalCard tone="paper" heavy className="p-4 text-center text-xl font-black uppercase" role="status">
          {p.captured ? 'YOU CAPTURED ✓ · ' : ''}WAITING FOR THE PHOTOS...
        </BrutalCard>
      ) : (
        <BrutalCard tone="yellow" heavy className="sticky bottom-2 flex flex-col gap-3 p-4">
          <h2 className="text-2xl font-black uppercase leading-none">BOTH READY?</h2>
          <div className="flex flex-wrap gap-2">
            <BrutalBadge tone={iAmReady ? 'lime' : 'paper'}>YOU {iAmReady ? 'READY ✓' : 'NOT READY'}</BrutalBadge>
            <BrutalBadge tone={p.partner?.ready ? 'lime' : 'paper'}>THEM {p.partner?.ready ? 'READY ✓' : 'WAITING...'}</BrutalBadge>
          </div>
          <BrutalButton tone={iAmReady ? 'lime' : 'ink'} size="xl" disabled={!p.canReady} onClick={() => p.onReady(!iAmReady)}>
            {iAmReady ? 'READY ✓' : "I'M READY"}
          </BrutalButton>
          {p.canFlip && (
            <BrutalButton tone="paper" onClick={p.onFlip}>
              FLIP CAMERA
            </BrutalButton>
          )}
        </BrutalCard>
      )}
    </main>
  )
}
```

- [ ] **Step 5: Wire the new props in `Booth.tsx`**

Add imports:
```tsx
import type { ConnKind } from '../components/ConnectionStatus'
import { Splash } from '../screens/Splash'
```
Replace the two plain splash returns and the `<main>` checks:
```tsx
  if (gate === 'checking') return <Splash text="CHECKING BOOTH…" />
  …
  if (!room.state) return <Splash text="CONNECTING…" />
```
Compute the shared header props right after `const hasResult = …`:
```tsx
  const hasPhotos = rounds.length > 0
  const status: ConnKind =
    room.status === 'reconnecting'
      ? 'reconnecting'
      : room.status !== 'open'
        ? 'lost'
        : !partner?.connected
          ? 'waiting'
          : rtc.peerState === 'connected'
            ? 'connected'
            : rtc.peerState === 'reconnecting'
              ? 'reconnecting'
              : 'connecting'
```
Remember that someone was here, so the lobby can say they left. Hooks must run before any early return, so put this **above** the first `if (gate === …)` return, right after the `useRoom` call:
```tsx
  const partnerConnected = room.state ? Boolean(room.state.participants[otherSlot(room.state.you)]?.connected) : false
  const [hadPartner, setHadPartner] = useState(false)
  useEffect(() => {
    if (partnerConnected) setHadPartner(true)
  }, [partnerConnected])
```
Pass everything on: `<Lobby code={code} shareUrl={…} status={status} hasPhotos={hasPhotos} stream={camera.stream} mirrored={camera.mirrored} canFlip={camera.canFlip} onFlip={() => void camera.flip()} partnerLeft={hadPartner} />` and to `<Stage … code={code} status={status} hasPhotos={hasPhotos} canFlip={camera.canFlip} onFlip={() => void camera.flip()} />` — **and delete the `peerState={rtc.peerState}` prop from `<Stage>`**: the new `Stage` takes `status` instead. (`Result` gets `code`, `status` in Task 23.)

- [ ] **Step 6: Verify**

Run: `npm run typecheck && npm run lint && npm test && npm run test:e2e`
Expected: every e2e spec still green (they rely on the preserved strings), plus `lobby.spec.ts`. Visually check the booth at 390×844 (THEM above YOU, ready card reachable with a thumb) and 1280×800 (YOU left, THEM right).

- [ ] **Step 7: Commit**

```bash
git add src/client e2e
git commit -m "feat: style the booth screens, add qr and copy link, restyle error states"
```

---

## Task 23: Filters, layouts, share, and the styled Result screen

**Files:**
- Create: `src/client/lib/filters.ts`, `src/client/lib/filters.test.ts`, `src/client/components/{BrutalRadioGroup,FilterPicker,PhotoStrip}.tsx`
- Modify: `src/client/lib/strip.ts` (add `filter` to `StripMeta`, filter each cell), `src/client/screens/Result.tsx` (replace), `src/client/pages/Booth.tsx`, `e2e/photos.spec.ts` (append)

**Interfaces:**
- Produces:
  - `type FilterId = 'original' | 'bw' | 'warm' | 'cool' | 'vintage' | 'contrast'`; `FILTERS: ReadonlyArray<{ id: FilterId; label: string }>`; `applyFilter(data: Uint8ClampedArray, id: FilterId): void` (in place, RGB only, alpha untouched)
  - `StripMeta` gains `filter: FilterId`
  - `BrutalRadioGroup<T extends string>({ legend, name, value, options: Array<{ value: T; label: string; disabled?: boolean }>, onChange })` — native radios (arrow keys, `getByRole('radio')`), selected = black fill / white text
  - `FilterPicker({ value, onChange })`; `PhotoStrip({ url, error })`
  - `Result` props gain `status: ConnKind`

- [ ] **Step 1: Write the failing filter tests**

`src/client/lib/filters.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { applyFilter, FILTERS, type FilterId } from './filters'

const px = (r: number, g: number, b: number, a = 255) => new Uint8ClampedArray([r, g, b, a])
const run = (id: FilterId, r: number, g: number, b: number, a = 255) => {
  const data = px(r, g, b, a)
  applyFilter(data, id)
  return [...data]
}

describe('applyFilter', () => {
  it('original changes nothing', () => {
    expect(run('original', 12, 200, 99)).toEqual([12, 200, 99, 255])
  })

  it.each(FILTERS.map((f) => f.id))('%s never touches alpha', (id) => {
    expect(run(id, 120, 80, 40, 77)[3]).toBe(77)
  })

  it('bw makes every channel equal (luma), keeping black and white', () => {
    expect(run('bw', 200, 100, 50)).toEqual([124, 124, 124, 255])
    expect(run('bw', 255, 255, 255).slice(0, 3)).toEqual([255, 255, 255])
    expect(run('bw', 0, 0, 0).slice(0, 3)).toEqual([0, 0, 0])
  })

  it('contrast pivots on mid-grey and clamps', () => {
    expect(run('contrast', 128, 128, 128).slice(0, 3)).toEqual([128, 128, 128])
    expect(run('contrast', 200, 200, 200)[0]).toBe(225)
    expect(run('contrast', 250, 250, 250)[0]).toBe(255)
    expect(run('contrast', 5, 5, 5)[0]).toBe(0)
  })

  it('warm pushes red up and blue down; cool does the opposite', () => {
    expect(run('warm', 128, 128, 128).slice(0, 3)).toEqual([146, 131, 115])
    expect(run('cool', 128, 128, 128).slice(0, 3)).toEqual([118, 128, 149])
  })

  it('vintage lifts blacks and never exceeds 255', () => {
    expect(run('vintage', 0, 0, 0).slice(0, 3)).toEqual([20, 20, 20])
    expect(run('vintage', 255, 255, 255).slice(0, 3)).toEqual([255, 255, 255])
  })

  it('handles many pixels, touching only RGB', () => {
    const data = new Uint8ClampedArray([10, 20, 30, 1, 40, 50, 60, 2])
    applyFilter(data, 'bw')
    expect(data[3]).toBe(1)
    expect(data[7]).toBe(2)
    expect(data[0]).toBe(data[1])
    expect(data[4]).toBe(data[6])
  })
})
```
Run: `npx vitest run src/client/lib/filters.test.ts` → FAIL (module missing).

- [ ] **Step 2: Implement filters**

`src/client/lib/filters.ts`:
```ts
export type FilterId = 'original' | 'bw' | 'warm' | 'cool' | 'vintage' | 'contrast'

export const FILTERS: ReadonlyArray<{ id: FilterId; label: string }> = [
  { id: 'original', label: 'ORIGINAL' },
  { id: 'bw', label: 'B&W' },
  { id: 'warm', label: 'WARM' },
  { id: 'cool', label: 'COOL' },
  { id: 'vintage', label: 'VINTAGE' },
  { id: 'contrast', label: 'HIGH CONTRAST' },
]

/**
 * In-place per-pixel filters over RGBA data. Done by hand rather than with `ctx.filter` because
 * Safari cannot be relied on for it. Uint8ClampedArray rounds and clamps on assignment.
 */
export function applyFilter(data: Uint8ClampedArray, id: FilterId): void {
  if (id === 'original') return
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] ?? 0
    const g = data[i + 1] ?? 0
    const b = data[i + 2] ?? 0
    switch (id) {
      case 'bw': {
        const y = 0.299 * r + 0.587 * g + 0.114 * b
        data[i] = data[i + 1] = data[i + 2] = y
        break
      }
      case 'warm':
        data[i] = r * 1.08 + 8
        data[i + 1] = g * 1.02
        data[i + 2] = b * 0.9
        break
      case 'cool':
        data[i] = r * 0.92
        data[i + 1] = g
        data[i + 2] = b * 1.1 + 8
        break
      case 'contrast':
        data[i] = (r - 128) * 1.35 + 128
        data[i + 1] = (g - 128) * 1.35 + 128
        data[i + 2] = (b - 128) * 1.35 + 128
        break
      case 'vintage': {
        // 70 % sepia + 30 % original, slightly dimmed, with the blacks lifted.
        const sr = 0.393 * r + 0.769 * g + 0.189 * b
        const sg = 0.349 * r + 0.686 * g + 0.168 * b
        const sb = 0.272 * r + 0.534 * g + 0.131 * b
        data[i] = (sr * 0.7 + r * 0.3) * 0.9 + 20
        data[i + 1] = (sg * 0.7 + g * 0.3) * 0.9 + 20
        data[i + 2] = (sb * 0.7 + b * 0.3) * 0.9 + 20
        break
      }
    }
  }
}
```
Run: `npx vitest run src/client/lib/filters.test.ts` → PASS.

- [ ] **Step 3: Apply the filter inside `renderStrip`**

In `src/client/lib/strip.ts`:
1. `import { applyFilter, type FilterId } from './filters'` and extend `StripMeta` with `filter: FilterId`.
2. Replace `drawCell` with:
```ts
function drawCell(ctx: CanvasRenderingContext2D, bmp: ImageBitmap, cell: Rect, tilt: number, filter: FilterId): void {
  // Crop to the cell on a scratch canvas first, so the filter only touches the photo (not paper or frame).
  const tile = document.createElement('canvas')
  tile.width = cell.w
  tile.height = cell.h
  const t = tile.getContext('2d')
  if (!t) throw new Error('2d canvas is unavailable')
  const { sx, sy, sw, sh } = coverRect(bmp.width, bmp.height, cell.w, cell.h)
  t.drawImage(bmp, sx, sy, sw, sh, 0, 0, cell.w, cell.h)
  if (filter !== 'original') {
    const pixels = t.getImageData(0, 0, cell.w, cell.h)
    applyFilter(pixels.data, filter)
    t.putImageData(pixels, 0, 0)
  }

  ctx.save()
  ctx.translate(cell.x + cell.w / 2, cell.y + cell.h / 2)
  ctx.rotate(tilt)
  ctx.fillStyle = INK
  ctx.fillRect(-cell.w / 2 - FRAME_BORDER, -cell.h / 2 - FRAME_BORDER, cell.w + FRAME_BORDER * 2, cell.h + FRAME_BORDER * 2)
  ctx.drawImage(tile, -cell.w / 2, -cell.h / 2)
  ctx.restore()
}
```
3. In `renderStrip`, change the call to `if (bmp) drawCell(ctx, bmp, cell, tilt, meta.filter)`.
Run: `npm run typecheck` (it will flag `Result.tsx`'s `meta`, fixed in Step 5).

- [ ] **Step 4: Radio group, filter picker, strip frame**

`src/client/components/BrutalRadioGroup.tsx`:
```tsx
interface Option<T extends string> {
  value: T
  label: string
  disabled?: boolean
}
interface Props<T extends string> {
  legend: string
  name: string
  value: T
  options: ReadonlyArray<Option<T>>
  onChange: (value: T) => void
}

/** Native radios, so arrow keys, grouping and screen-reader semantics come for free. The input covers the label, so clicks and taps land on it. */
export function BrutalRadioGroup<T extends string>({ legend, name, value, options, onChange }: Props<T>) {
  return (
    <fieldset className="m-0 border-0 p-0">
      <legend className="mb-2 text-xs font-black uppercase tracking-[0.2em]">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <label key={o.value} className="relative">
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={value === o.value}
              disabled={o.disabled}
              onChange={() => onChange(o.value)}
              className="peer absolute inset-0 m-0 cursor-pointer opacity-0 disabled:cursor-not-allowed"
            />
            <span className="block min-h-12 border-[3px] border-ink bg-paper px-3 py-3 text-sm font-black uppercase leading-none text-ink shadow-brutal-sm peer-checked:bg-ink peer-checked:text-white peer-disabled:opacity-50 peer-focus-visible:outline-[3px] peer-focus-visible:outline-offset-[3px] peer-focus-visible:outline-ink peer-focus-visible:shadow-[0_0_0_6px_#ffe600]">
              {o.label}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}
```

`src/client/components/FilterPicker.tsx`:
```tsx
import { FILTERS, type FilterId } from '../lib/filters'
import { BrutalRadioGroup } from './BrutalRadioGroup'

export function FilterPicker({ value, onChange }: { value: FilterId; onChange: (id: FilterId) => void }) {
  return (
    <BrutalRadioGroup
      legend="Filter"
      name="filter"
      value={value}
      onChange={onChange}
      options={FILTERS.map((f) => ({ value: f.id, label: f.label }))}
    />
  )
}
```

`src/client/components/PhotoStrip.tsx`:
```tsx
/** The finished strip, framed like a print pinned to a board. */
export function PhotoStrip({ url, error }: { url: string | null; error: boolean }) {
  if (error) {
    return (
      <p role="alert" className="border-4 border-ink bg-orange p-4 text-lg font-black uppercase">
        COULDN'T BUILD THE STRIP. TRY A DIFFERENT LAYOUT.
      </p>
    )
  }
  if (!url) return <p className="border-4 border-ink bg-yellow p-4 text-lg font-black uppercase">DEVELOPING...</p>
  return (
    <div className="mx-auto w-fit max-w-full rotate-1 border-4 border-ink bg-white p-2 shadow-brutal">
      <img src={url} alt="Photo strip" className="block max-h-[70dvh] max-w-full" />
    </div>
  )
}
```

- [ ] **Step 5: The styled Result screen**

Replace `src/client/screens/Result.tsx`:
```tsx
import { useMemo, useState } from 'react'
import { APP_NAME } from '../../shared/constants'
import type { PState } from '../../shared/protocol'
import { BoothHeader } from '../components/BoothHeader'
import { BrutalBadge } from '../components/BrutalBadge'
import { BrutalButton } from '../components/BrutalButton'
import { BrutalCard } from '../components/BrutalCard'
import { BrutalRadioGroup } from '../components/BrutalRadioGroup'
import { useToast } from '../components/BrutalToast'
import type { ConnKind } from '../components/ConnectionStatus'
import { FilterPicker } from '../components/FilterPicker'
import { PhotoStrip } from '../components/PhotoStrip'
import { useStrip } from '../hooks/useStrip'
import type { FilterId } from '../lib/filters'
import { canvasToBlob, type StripLayout } from '../lib/photo'
import { stripBlobs, type Round } from '../lib/rounds'
import { downloadBlob, formatStripDate, shareImage } from '../lib/strip'

interface Props {
  code: string
  status: ConnKind
  rounds: Round[]
  me: PState | null
  partner: PState | null
  partnerHere: boolean
  canRetake: boolean
  onReady: (ready: boolean) => void
}

export function Result({ code, status, rounds, me, partner, partnerHere, canRetake, onReady }: Props) {
  const toast = useToast()
  const [layout, setLayout] = useState<StripLayout>('vertical')
  const [filter, setFilter] = useState<FilterId>('original')
  const [format, setFormat] = useState<'png' | 'jpg'>('png')
  const latest = rounds[rounds.length - 1]
  const blobs = useMemo(() => stripBlobs(layout, rounds), [layout, rounds])
  const meta = useMemo(
    () => ({ code, filter, dateLabel: formatStripDate(new Date()), seed: `${code}:${latest?.round ?? 0}` }),
    [code, filter, latest?.round],
  )
  const { url, canvas, error } = useStrip(blobs, layout, meta)
  const iAmReady = me?.ready ?? false
  const filename = `${APP_NAME.toLowerCase()}-${code}-${latest?.round ?? 0}.${format}`

  async function encode(): Promise<Blob | null> {
    return canvas ? canvasToBlob(canvas, format === 'png' ? 'image/png' : 'image/jpeg', 0.92) : null
  }
  async function download() {
    const blob = await encode()
    if (blob) downloadBlob(blob, filename)
  }
  async function share() {
    const blob = await encode()
    if (!blob) return
    if ((await shareImage(blob, filename, 'Made in the booth.')) === 'unsupported') {
      downloadBlob(blob, filename)
      toast('PHOTO SAVED.')
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-5 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
      <BoothHeader code={code} status={status} hasPhotos />
      <h1 className="text-5xl font-black uppercase leading-[0.9] tracking-tighter">LOOK WHAT YOU MADE.</h1>
      {!partnerHere && (
        <BrutalCard tone="orange" className="p-3 text-lg font-black uppercase" role="status">
          THEY LEFT :( SAVE YOUR STRIP BEFORE YOU GO.
        </BrutalCard>
      )}

      <PhotoStrip url={url} error={error} />

      <BrutalCard heavy className="flex flex-col gap-5 p-4">
        <BrutalRadioGroup
          legend="Layout"
          name="layout"
          value={layout}
          onChange={setLayout}
          options={[
            { value: 'vertical', label: 'VERTICAL' },
            { value: 'horizontal', label: 'HORIZONTAL' },
            { value: 'grid', label: 'GRID', disabled: rounds.length < 2 },
          ]}
        />
        <FilterPicker value={filter} onChange={setFilter} />
        <BrutalRadioGroup
          legend="File type"
          name="format"
          value={format}
          onChange={setFormat}
          options={[
            { value: 'png', label: 'PNG' },
            { value: 'jpg', label: 'JPG' },
          ]}
        />
      </BrutalCard>

      <BrutalButton tone="yellow" size="xl" className="w-full" disabled={!canvas} onClick={() => void download()}>
        DOWNLOAD PHOTO
      </BrutalButton>
      <BrutalButton tone="pink" className="w-full" disabled={!canvas} onClick={() => void share()}>
        SHARE
      </BrutalButton>

      {partnerHere && (
        <BrutalCard tone="lime" heavy className="flex flex-col gap-3 p-4">
          <div className="flex flex-wrap gap-2">
            <BrutalBadge tone={iAmReady ? 'ink' : 'paper'}>YOU {iAmReady ? 'READY ✓' : 'NOT READY'}</BrutalBadge>
            <BrutalBadge tone={partner?.ready ? 'ink' : 'paper'}>THEM {partner?.ready ? 'READY ✓' : 'WAITING...'}</BrutalBadge>
          </div>
          <BrutalButton tone="ink" disabled={!canRetake} onClick={() => onReady(!iAmReady)}>
            {iAmReady ? 'READY ✓' : 'RETAKE'}
          </BrutalButton>
        </BrutalCard>
      )}
    </main>
  )
}
```
In `Booth.tsx` pass `code={code}` and `status={status}` to `<Result … />` and remove the props `Result` no longer takes.

- [ ] **Step 6: e2e for filters**

Append to `e2e/photos.spec.ts`:
```ts
test('a filter re-renders the strip; B&W really is greyscale', async ({ browser }) => {
  const { a, b } = await connectedPair(browser)
  await pressReady(a)
  await pressReady(b)
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
})
```
(The strip loads from a same-origin blob URL, so reading its pixels does not taint the canvas.)

- [ ] **Step 7: Verify and commit**

Run: `npm run check && npm run test:e2e -- photos.spec.ts`
Expected: green (the Phase 3 layout/format tests keep passing because the radios keep their accessible names; `check()` and `click()` both work on the covering input).
```bash
git add src/client e2e
git commit -m "feat: add photo filters, layout and file type pickers, share and a styled result screen"
```

---

## Task 24: Accessibility, reduced motion, security headers, error and mobile e2e

**Files:**
- Create: `public/_headers`, `e2e/a11y.spec.ts`, `e2e/errors.spec.ts`
- Modify: `package.json` / lockfile (adds `@axe-core/playwright`)

**Interfaces:**
- Consumes: everything above. Produces: the verified-accessibility and error-path regression suite.

- [ ] **Step 1: Security headers**

`public/_headers` (Workers static assets apply this file to every asset response):
```
/*
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; font-src 'self' data:; connect-src 'self' wss:; worker-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'
  Permissions-Policy: camera=(self), microphone=(), geolocation=()
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
```
(`'unsafe-inline'` is for style attributes only — React's `style={{ transform }}` on the camera frames. No inline *script* is allowed. `connect-src 'self'` already covers same-host `ws:`/`wss:`; the extra `wss:` keeps a future cross-host TURN/relay option open.)

- [ ] **Step 2: Install axe and write the accessibility spec**

Run: `npm install -D @axe-core/playwright`

`e2e/a11y.spec.ts`:
```ts
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { BASE, connectedPair, createBooth, enterBooth, newPlayer, pressReady } from './helpers'

async function expectNoViolations(page: Page, what: string) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    // The booth's <video> elements are live, silent camera streams (getUserMedia audio:false): there is no speech to caption.
    .disableRules(['video-caption'])
    .analyze()
  expect(results.violations.map((v) => `${what}: ${v.id} (${v.nodes.length}) ${v.help}`), what).toEqual([])
}

test('landing, join and create screens have no WCAG A/AA violations', async ({ browser }) => {
  const page = await newPlayer(browser)
  await page.goto('/')
  await expectNoViolations(page, 'home')
  await page.goto('/join')
  await expectNoViolations(page, 'join')
  await page.goto('/b/ZZZZZZ')
  await expect(page.getByText('NO SUCH BOOTH.')).toBeVisible()
  await expectNoViolations(page, 'not found')
})

test('camera gate, lobby, stage, countdown and result have no violations', async ({ browser }) => {
  const a = await newPlayer(browser)
  await createBooth(a)
  await expectNoViolations(a, 'camera gate')
  await enterBooth(a)
  await expect(a.getByText('WAITING FOR YOUR PERSON...')).toBeVisible()
  await expectNoViolations(a, 'lobby')
  await a.close()

  const { a: left, b: right } = await connectedPair(browser)
  await expectNoViolations(left, 'stage')
  await pressReady(left)
  await pressReady(right)
  await expect(left.getByRole('heading', { name: 'LOOK WHAT YOU MADE.' })).toBeVisible({ timeout: 30_000 })
  await expectNoViolations(left, 'result')
})

test('the first thing keyboard focus reaches is visible, and every control is reachable by keyboard', async ({ browser }) => {
  const page = await newPlayer(browser)
  await page.goto('/')
  await page.keyboard.press('Tab')
  const outline = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement
    const s = getComputedStyle(el)
    return { tag: el.tagName, style: s.outlineStyle, width: parseFloat(s.outlineWidth) }
  })
  expect(outline.style).not.toBe('none')
  expect(outline.width).toBeGreaterThanOrEqual(3)

  // Tab through the whole landing page: nothing may trap focus.
  const seen = new Set<string>()
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Tab')
    seen.add(await page.evaluate(() => document.activeElement?.textContent?.trim().slice(0, 30) ?? ''))
  }
  expect(seen.size).toBeGreaterThan(4)
})

test('prefers-reduced-motion removes the pop animation', async ({ browser }) => {
  const context = await browser.newContext({ baseURL: BASE, permissions: ['camera'], reducedMotion: 'reduce' })
  const page = await context.newPage()
  await createBooth(page)
  await enterBooth(page)
  const pop = page.locator('.animate-pop').first() // "WAITING FOR YOUR PERSON..." pops in normally
  await expect(pop).toBeVisible()
  const duration = await pop.evaluate((el) => parseFloat(getComputedStyle(el).animationDuration))
  expect(duration).toBeLessThan(0.001) // the media query forces 0.01 ms

  const normal = await newPlayer(browser)
  await createBooth(normal)
  await enterBooth(normal)
  const normalDuration = await normal.locator('.animate-pop').first().evaluate((el) => parseFloat(getComputedStyle(el).animationDuration))
  expect(normalDuration).toBeGreaterThan(0.05) // and without the preference it really animates
  await context.close()
})

test('mobile: nothing scrolls sideways and the READY button is on screen without scrolling', async ({ browser }) => {
  const viewport = { width: 390, height: 844 }
  const a = await newPlayer(browser, { viewport })
  const b = await newPlayer(browser, { viewport })
  const url = await createBooth(a)
  for (const page of [a]) {
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  }
  await enterBooth(a)
  await b.goto(url)
  await enterBooth(b)
  await expect(a.getByTestId('remote-video')).toBeVisible()

  for (const page of [a, b]) {
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    const ready = page.getByRole('button', { name: /i'm ready/i })
    await expect(ready).toBeVisible()
    const box = await ready.boundingBox()
    expect(box?.height).toBeGreaterThanOrEqual(48) // thumb-sized
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(viewport.height)
  }
})
```

- [ ] **Step 3: Error-path spec**

`e2e/errors.spec.ts`:
```ts
import { expect, test } from '@playwright/test'
import { connectedPair, createBooth, enterBooth, expectRemoteVideo, newPlayer } from './helpers'

const denyCamera = (name: string) => () => {
  navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('nope', name))
}

test('camera blocked shows the brief copy and lets you try again', async ({ browser }) => {
  const page = await newPlayer(browser)
  await createBooth(page)
  await page.addInitScript(denyCamera('NotAllowedError'))
  await page.reload()
  await enterBooth(page)
  await expect(page.getByText('CAMERA BLOCKED')).toBeVisible()
  await expect(page.getByText('WE NEED CAMERA ACCESS TO USE THE BOOTH.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'TRY AGAIN' })).toBeVisible()
})

test('no camera, and no camera API, each get their own message', async ({ browser }) => {
  const missing = await newPlayer(browser)
  await createBooth(missing)
  await missing.addInitScript(denyCamera('NotFoundError'))
  await missing.reload()
  await enterBooth(missing)
  await expect(missing.getByText('NO CAMERA FOUND')).toBeVisible()

  const insecure = await newPlayer(browser)
  await createBooth(insecure)
  await insecure.addInitScript(() => Object.defineProperty(navigator, 'mediaDevices', { value: undefined }))
  await insecure.reload()
  await enterBooth(insecure)
  await expect(insecure.getByText('CAMERA NEEDS HTTPS')).toBeVisible()
})

test('when the partner leaves you are told, and their slot stays reserved against strangers', async ({ browser }) => {
  const { a, b, url } = await connectedPair(browser)
  await b.close()
  await expect(a.getByText('THEY LEFT :(')).toBeVisible()
  await expect(a.getByText('WAITING FOR THEM TO COME BACK.')).toBeVisible()
  await expect(a.getByText('WAITING FOR YOUR PERSON...')).toBeVisible()
  const stranger = await newPlayer(browser)
  await stranger.goto(url) // a brand-new person: the leaver's slot is reserved for them for the grace period
  await expect(stranger.getByText('BOOTH FULL.')).toBeVisible()
})

test('the leaver can come back (same tab storage) and both see video again', async ({ browser }) => {
  const { a, b } = await connectedPair(browser)
  await b.reload()
  await enterBooth(b)
  await expectRemoteVideo(a)
  await expectRemoteVideo(b)
})

test('opening the same booth as the same person in a second tab replaces the first', async ({ browser }) => {
  const first = await newPlayer(browser)
  const url = await createBooth(first)
  await enterBooth(first)
  const code = url.split('/b/')[1] ?? ''
  const id = await first.evaluate((c) => sessionStorage.getItem(`booth:pid:${c}`), code)
  expect(id).toBeTruthy()

  const second = await newPlayer(browser)
  await second.addInitScript(([c, v]) => sessionStorage.setItem(`booth:pid:${c}`, v as string), [code, id])
  await second.goto(url)
  await enterBooth(second)

  await expect(first.getByText('OPENED ELSEWHERE.')).toBeVisible()
  await expect(second.getByText('WAITING FOR YOUR PERSON...')).toBeVisible()
})
```
Note on the third test's title: it deliberately documents the reservation rule — a stranger cannot take a leaver's slot within the 2-minute grace period. If you would rather the stranger be allowed in immediately, that is a spec change (D-row), not a test tweak.

- [ ] **Step 4: Verify the headers on a production build**

```bash
npm run build
(npx vite preview --port 5198 --strictPort > node_modules/.tmp/preview.log 2>&1 &)
sleep 6
curl -sI http://localhost:5198/ | grep -iE "content-security-policy|permissions-policy|x-content-type|referrer-policy"
pkill -f "vite preview" || true
```
Expected: the four headers print. If the preview server does not serve `_headers` (some plugin versions only apply it on deploy), note that in the README under "Verified here / needs your deploy" and re-check after the first `wrangler deploy` with `curl -sI https://<your-worker>.workers.dev/`.
Also load the production preview in a browser once: create and join a booth, confirm the camera, WebSocket and QR image all work under the CSP (watch the console for CSP violations — fix the policy, never loosen `script-src`).

- [ ] **Step 5: Run everything and fix real findings**

Run: `npm run check && npm run test:e2e`
Expected: green. For an axe violation: fix the markup/colours (e.g. a text/background pair under 4.5:1), never disable the rule. For "reduced-motion" failing: the `@media` block in `index.css` must be loaded (check Task 20 Step 2).

- [ ] **Step 6: Commit**

```bash
git add public package.json package-lock.json e2e
git commit -m "feat: add security headers and accessibility, error-path and mobile e2e coverage"
```

---

## Task 25: README, manual device checklist, final verification

**Files:**
- Create: `README.md`

**Interfaces:** none; this task documents and verifies.

- [ ] **Step 1: Write the README**

`README.md` must contain these sections (write real content, not placeholders):

1. **What it is** — two sentences + the architecture diagram from the spec §4.
2. **Run it locally** — `npm install`, `npm run dev` (http://localhost:5173, secure context on `localhost`), `npm run check`, `npm run test:e2e` (first time `npm run e2e:install`).
3. **Test on a phone** — phones need HTTPS for the camera. Option A (recommended): `cloudflared tunnel --url http://localhost:5173` and open the printed `https://*.trycloudflare.com` URL on both phones (`vite.config.ts` already allows that host); warn that the tunnel exposes the dev server publicly while running. Option B: deploy to `workers.dev` and test there.
4. **Deploy** — `npx wrangler login`, `npm run deploy`; what `wrangler.jsonc` binds (Durable Object via `exports`, assets, two rate-limit namespaces — change `namespace_id`s if they collide in your account); routes/custom domain via the Cloudflare dashboard or a `routes` entry; R2 is deliberately not used.
5. **TURN (optional)** — create a Cloudflare Realtime TURN key; set `TURN_KEY_ID` in `wrangler.jsonc` `vars`; `npx wrangler secret put TURN_KEY_API_TOKEN`; local `.dev.vars`; clients only ever receive short-lived credentials from `/api/ice`; note that with TURN the media can be relayed (still end-to-end encrypted by DTLS-SRTP) so "directly when possible" stays accurate.
6. **How synchronization works** — server owns `captureAt`; NTP-style offset (8 pings at join, 4 on ready, lowest-RTT sample wins); capture = `setTimeout` to `captureAt − 40 ms` then `requestAnimationFrame` spin; the 3-2-1 is derived from the same timestamp; **honest accuracy statement**: within roughly 1–3 camera frames (clock error ≤ RTT/2 of the best sample + ≤ 16 ms timer granularity + ~33 ms frame interval), not exact.
7. **Privacy and security** — what is and isn't stored (DO record: room code, round counter, participant ids, timestamps; nothing else), expiry after 1 h idle, no analytics, CSP and headers, strong 6-character codes (~29.7 bits) + per-IP rate limits + two-person cap.
8. **Preview = result** — mirrored previews and photos match (D15); filters apply after capture only.
9. **Limits and decisions** — no audio, no R2, no photo relay through the server, photos live only in the tab (leave warning), grid needs two rounds, TWO-UP is a placeholder name (`APP_NAME`).
10. **Manual test checklist (needs real devices)** — copy the table below verbatim.

| # | Check | Expected |
|---|---|---|
| 1 | iPhone Safari ↔ Android Chrome on **different networks**, via HTTPS URL | both see each other; READY → 3-2-1 → both strips match |
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

- [ ] **Step 2: Final automated verification** (record the actual output in the report; do not paraphrase)

```bash
npm run typecheck
npm run lint
npm test
npm run test:e2e
npm run build
git status --short   # must be clean
```
Expected: every command exits 0; `git status` clean.

- [ ] **Step 3: Write the verification report into the README** under "Verification status"

A table with one row per item of brief §47, each marked exactly one of: **verified here** (name the command or spec that proves it), **needs your device** (point to the checklist row), or **not done** (say why). Use these true values unless reality differs when you run it:
- TypeScript checker, lint, imports → verified here (`npm run check`).
- Cloudflare bindings, Durable Object behaviour, WebSocket connections → verified here (worker tests + e2e); **actual Cloudflare deployment → not done** (needs `wrangler login`; run on request).
- Two browsers simultaneously, synchronized capture, photo generation, download, mobile layout (390 px) and desktop layout, reduced motion, permissions, disconnect/reconnect → verified here (named e2e specs; Chromium only).
- Two physical phones, phones on different networks, real mobile browsers, Firefox/Safari desktop, real TURN → **needs your device** (checklist rows 1, 6, 10).

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: add readme, manual device checklist and verification status"
```

- [ ] **Step 5: Hand-off message** (to the user, plain and short)

State: what was built; the exact commands run and their results; the checklist rows only they can run; that nothing was pushed or deployed; and how to deploy (`npx wrangler login && npm run deploy`). Do **not** claim anything under "needs your device" as tested.

**Phase 4 gate reached. The project is complete.**
