# Phase 2 — Screens (Tasks 4–8)

> Part of `2026-10-08-wizard-flow.md`. **Read that master file first** (Global Constraints and Review Focus apply to every task here). Spec: `docs/superpowers/specs/2026-10-08-wizard-flow-design.md` §3 (screens), §6 (client), §7 (look), §8 (copy).

**Phase goal:** every wizard screen exists as a self-contained component that renders from props — `RoomScreen`, `FrameScreen`, `ShootScreen`, `PickScreen`, `StyleScreen`, `DoneScreen`, `LostPhotosScreen` — inside a shared `WizardShell` (header, stepper, heading, pinned bottom bar). Nothing is wired to the room yet; `Booth.tsx` still holds the old flow until Phase 3.

**How screens are tested (no DOM needed):** `src/client/test-render.tsx` (Task 4) server-renders a component to static markup with `react-dom/server`, inside a `MemoryRouter`. Tests assert copy, which buttons exist, which are disabled, which radio is checked and `aria-current`. Interactions (taps) and focus are covered by the Playwright specs in Phase 3 — a unit test cannot click.

**Gate (all must pass before Phase 3):**
1. `npm test` green (unit + worker).
2. `npm run lint` green.
3. No type errors in the files this phase touches:
   `npx tsc -p tsconfig.client.json --noEmit --pretty false 2>&1 | grep -E "^src/(shared/|client/(test-render|lib/(labels|takes)|components/(Stepper|ActionBar|WizardShell|LiveFrame|CodeTiles|BrutalButton|BrutalBadge|BrutalRadioGroup|ConnectionStatus|BoothHeader|Countdown|PhotoStrip|BackgroundPicker)|screens/(RoomScreen|FrameScreen|ShootScreen|PickScreen|StyleScreen|DoneScreen|LostPhotosScreen)|hooks/(useStyleState|useFinishedStrip)))" || echo "no errors in this phase's files"` — expect the echo. (`--pretty false` and the `^` anchor matter: the default pretty output also prints the *related* file of an error in another file, which would be a false positive.)

`npm run typecheck` stays red (the old `Booth.tsx`, `Stage.tsx`, … still use the old plan) until Task 10, and `e2e/` stops type-checking from Task 9 until Task 12.

**Look rules for every file in this phase** (they are enforced by `src/client/style-rules.test.ts`, which scans comments too): never write `gradient`, `blur(`, `blur-`, `shadow-sm/md/lg/xl/2xl`, `rounded-xl/2xl/3xl/full`. Sentence case: no `uppercase` class, no rotation classes (`rotate-*`, `-rotate-*`). One primary button per screen, in the bottom bar.

---

## Task 4: Wizard building blocks — shell, stepper, bottom bar, calmer base components

**Files:**
- Create: `src/client/test-render.tsx`, `src/client/components/Stepper.tsx`, `src/client/components/ActionBar.tsx`, `src/client/components/WizardShell.tsx`, `src/client/components/WizardShell.test.tsx`
- Modify: `src/client/lib/labels.ts`, `src/client/lib/labels.test.ts`, `src/client/components/BrutalButton.tsx`, `src/client/components/BrutalBadge.tsx`, `src/client/components/BrutalRadioGroup.tsx`, `src/client/components/ConnectionStatus.tsx`, `src/client/components/BoothHeader.tsx`

**Interfaces:**
- Consumes: `Step`, `STEPS`, `Plan` (`shared/plan`); `STEP_LABEL`, `stepIndex` (`lib/labels`, Phase 1 Task 3).
- Produces:
  - `lib/labels.ts`: `interface StepperItem { step: Step; label: string; state: 'done' | 'current' | 'todo'; tappable: boolean }`, `stepperItems(current: Step, running: boolean): StepperItem[]`, `shotLabel(plan: Pick<Plan, 'shots' | 'target'>): string` (`"Shot 2 of 6"`).
  - `test-render.tsx`: `render(element): string`, `buttons(html): ButtonInfo[]`, `buttonNamed(html, name: string | RegExp): ButtonInfo | undefined`, `radios(html): RadioInfo[]` where `ButtonInfo = { attrs: string; text: string; disabled: boolean }`, `RadioInfo = { name: string; value: string; checked: boolean; disabled: boolean }`.
  - `components/Stepper.tsx`: `Stepper({ step, running, canEdit, onGo })`.
  - `components/ActionBar.tsx`: `ActionBar({ children, back? })` with `back?: { onClick: () => void; disabled?: boolean }`; renders `data-testid="action-bar"`.
  - `components/WizardShell.tsx`: `interface ShellInfo { code: string; status: ConnKind; hasPhotos: boolean; running: boolean; canEdit: boolean; onGo: (to: Step) => void }` and `WizardShell(props: ShellInfo & { step: Step | null; title: string; lead?: string; wide?: boolean; primary?: ReactNode; backless?: boolean; children?: ReactNode })`.
  - Restyled (API unchanged): `BrutalButton`/`buttonClass`, `BrutalBadge`, `BrutalRadioGroup`, `ConnectionStatus`, `BoothHeader`.

- [ ] **Step 1: Failing tests for the label helpers**

Append to `src/client/lib/labels.test.ts` (keep the existing tests; extend the import line to `import { shotLabel, STEP_LABEL, stepIndex, stepperItems, TEMPLATE_LABEL, whoLabel } from './labels'`):
```ts
describe('stepperItems', () => {
  it('marks finished steps done and tappable, the current one current, the rest todo', () => {
    const items = stepperItems('pick', false)
    expect(items.map((i) => [i.label, i.state, i.tappable])).toEqual([
      ['Frame', 'done', true],
      ['Shoot', 'done', true],
      ['Pick', 'current', false],
      ['Style', 'todo', false],
      ['Done', 'todo', false],
    ])
  })
  it('nothing can be tapped while a sequence is running', () => {
    expect(stepperItems('shoot', true).some((i) => i.tappable)).toBe(false)
    expect(stepperItems('pick', true).some((i) => i.tappable)).toBe(false)
  })
  it('the first step has nothing to go back to', () => {
    expect(stepperItems('frame', false).some((i) => i.tappable)).toBe(false)
  })
})

describe('shotLabel', () => {
  it('counts the shot in flight, not the ones already taken', () => {
    expect(shotLabel({ shots: [], target: 6 })).toBe('Shot 1 of 6')
    expect(shotLabel({ shots: [1], target: 6 })).toBe('Shot 2 of 6')
  })
  it('never counts past the target', () => {
    expect(shotLabel({ shots: [1, 2, 3, 4, 5, 6], target: 6 })).toBe('Shot 6 of 6')
  })
})
```
Run: `npx vitest run src/client/lib/labels.test.ts`
Expected: FAIL — `stepperItems` and `shotLabel` are not exported yet.

- [ ] **Step 2: Add the helpers to `labels.ts`**

In `src/client/lib/labels.ts` change the first import to `import type { CellKind, Plan, Step, TemplateId } from '../../shared/plan'` and append:
```ts
export interface StepperItem {
  step: Step
  label: string
  state: 'done' | 'current' | 'todo'
  /** A finished step can be tapped to go back, unless a sequence is running. */
  tappable: boolean
}

export function stepperItems(current: Step, running: boolean): StepperItem[] {
  const at = stepIndex(current)
  return STEPS.map((step, i): StepperItem => ({
    step,
    label: STEP_LABEL[step],
    state: i < at ? 'done' : i === at ? 'current' : 'todo',
    tappable: i < at && !running,
  }))
}

/** "Shot 2 of 6": the shot in flight (or next), never beyond the target. */
export const shotLabel = (plan: Pick<Plan, 'shots' | 'target'>): string =>
  `Shot ${Math.min(plan.shots.length + 1, plan.target)} of ${plan.target}`
```
Run: `npx vitest run src/client/lib/labels.test.ts`
Expected: PASS.

- [ ] **Step 3: The render helper**

Create `src/client/test-render.tsx`:
```tsx
import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'

/** Server-render a screen to static markup (no DOM needed), inside a router because the booth header navigates. */
export const render = (element: ReactElement): string => renderToStaticMarkup(<MemoryRouter>{element}</MemoryRouter>)

export interface ButtonInfo {
  attrs: string
  text: string
  disabled: boolean
}

const hasAttr = (attrs: string, name: string): boolean => new RegExp(`\\s${name}(?:=|\\s|$)`).test(` ${attrs}`)

/** React escapes these in text nodes; a label like "I'm ready" must compare as typed. */
const decode = (text: string): string =>
  text.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')

/** Every <button> in the markup: its attributes, its visible text (tags stripped, entities decoded) and whether it is disabled. */
export function buttons(html: string): ButtonInfo[] {
  return [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map((m) => ({
    attrs: m[1] ?? '',
    text: decode((m[2] ?? '').replace(/<[^>]+>/g, '')).trim(),
    disabled: hasAttr(m[1] ?? '', 'disabled'),
  }))
}

export const buttonNamed = (html: string, name: string | RegExp): ButtonInfo | undefined =>
  buttons(html).find((b) => (typeof name === 'string' ? b.text === name : name.test(b.text)))

export interface RadioInfo {
  name: string
  value: string
  checked: boolean
  disabled: boolean
}

/** Every radio input in the markup. */
export function radios(html: string): RadioInfo[] {
  return [...html.matchAll(/<input\b([^>]*)>/g)]
    .map((m) => m[1] ?? '')
    .filter((attrs) => /type="radio"/.test(attrs))
    .map((attrs) => ({
      name: /name="([^"]*)"/.exec(attrs)?.[1] ?? '',
      value: /value="([^"]*)"/.exec(attrs)?.[1] ?? '',
      checked: hasAttr(attrs, 'checked'),
      disabled: hasAttr(attrs, 'disabled'),
    }))
}
```

- [ ] **Step 4: Failing tests for the shell**

Create `src/client/components/WizardShell.test.tsx`:
```tsx
import { describe, expect, it } from 'vitest'
import type { Step } from '../../shared/plan'
import { buttonNamed, buttons, render } from '../test-render'
import { WizardShell, type ShellInfo } from './WizardShell'

const info: ShellInfo = { code: 'ABCDEF', status: 'connected', hasPhotos: false, running: false, canEdit: true, onGo: () => {} }
const page = (step: Step | null, over: Partial<ShellInfo> = {}, extra: { backless?: boolean; primary?: boolean } = {}) =>
  render(
    <WizardShell
      {...info}
      {...over}
      step={step}
      title="A title"
      backless={extra.backless}
      primary={extra.primary === false ? undefined : <button type="button">Next</button>}
    >
      <p>body</p>
    </WizardShell>,
  )

describe('WizardShell', () => {
  it('has the title as the page heading, the room code, and the body', () => {
    const html = page('pick')
    expect(html).toMatch(/<h1[^>]*>A title<\/h1>/)
    expect(html).toContain('ABC DEF')
    expect(html).toContain('<p>body</p>')
  })

  it('marks exactly the current step and announces it', () => {
    const html = page('pick')
    expect(html.match(/aria-current="step"/g)).toHaveLength(1)
    expect(html).toMatch(/aria-current="step"[^>]*>(?:(?!<\/li>)[\s\S])*Pick/)
    expect(html).toContain('Step 3 of 5: Pick')
  })

  it('lets you tap back to finished steps only', () => {
    const html = page('pick')
    expect(buttonNamed(html, /^Frame/)?.disabled).toBe(false)
    expect(buttonNamed(html, /^Shoot/)?.disabled).toBe(false)
    expect(buttonNamed(html, /^Pick/)).toBeUndefined() // the current step is not a button
    expect(buttonNamed(html, /^Style/)).toBeUndefined()
    expect(buttonNamed(html, /^Done/)).toBeUndefined()
  })

  it('has no stepper before the wizard starts (the room-code screen)', () => {
    const html = page(null)
    expect(html).not.toContain('aria-label="Progress"')
    expect(html).not.toContain('aria-current')
  })

  it('shows a Back link on every step but the first, and Back is quiet (not the primary)', () => {
    expect(buttonNamed(page('frame'), 'Back')).toBeUndefined()
    expect(buttonNamed(page('shoot'), 'Back')?.disabled).toBe(false)
    expect(buttonNamed(page(null), 'Back')).toBeUndefined()
  })

  it('can hide Back for a screen with nothing sensible to go back to', () => {
    expect(buttonNamed(page('pick', {}, { backless: true }), 'Back')).toBeUndefined()
  })

  // Review Focus 4: while a sequence runs nobody can move the plan.
  it('offers neither Back nor stepper taps while a sequence is running', () => {
    const html = page('shoot', { running: true })
    expect(buttonNamed(html, 'Back')).toBeUndefined()
    expect(buttonNamed(html, /^Frame/)).toBeUndefined()
  })

  it('greys out Back and the stepper when the plan cannot change right now', () => {
    const html = page('pick', { canEdit: false })
    expect(buttonNamed(html, 'Back')?.disabled).toBe(true)
    expect(buttonNamed(html, /^Frame/)?.disabled).toBe(true)
  })

  it('pins the primary button in an action bar, and has no bar without one', () => {
    const withPrimary = page('frame')
    expect(withPrimary).toContain('data-testid="action-bar"')
    expect(buttonNamed(withPrimary, 'Next')).toBeDefined()
    expect(page('frame', {}, { primary: false })).not.toContain('data-testid="action-bar"')
  })

  it('the header keeps a way out', () => {
    expect(buttons(page('frame')).some((b) => b.text === 'Leave')).toBe(true)
  })
})
```
Run: `npx vitest run src/client/components/WizardShell.test.tsx`
Expected: FAIL — `./WizardShell` does not exist.

- [ ] **Step 5: Restyle the base components (calmer: sentence case, no tilt, no caps)**

`src/client/components/BrutalButton.tsx` — replace `buttonClass` with:
```ts
export function buttonClass(tone: Tone = 'yellow', size: 'md' | 'xl' = 'md'): string {
  return [
    'inline-flex items-center justify-center gap-2 border-[3px] border-ink font-black leading-none shadow-brutal',
    'transition-transform duration-75 active:translate-x-1 active:translate-y-1 active:shadow-press',
    'disabled:pointer-events-none disabled:translate-x-1 disabled:translate-y-1 disabled:opacity-60 disabled:shadow-press',
    size === 'xl' ? 'min-h-14 px-6 py-4 text-xl' : 'min-h-12 px-4 py-3 text-base',
    TONE[tone],
  ].join(' ')
}
```
(The `uppercase` and `tracking-tight` classes are gone; callers pass the text they want shown.)

`src/client/components/BrutalBadge.tsx` — change the `className` template to
```
`inline-flex items-center gap-2 border-[3px] border-ink px-2 py-1 text-sm font-bold ${TONE[tone]} ${className}`
```

`src/client/components/BrutalRadioGroup.tsx` — change the legend class to `mb-2 text-sm font-black` and the option `<span>` class to
```
block min-h-12 border-[3px] border-ink bg-paper px-3 py-3 text-base font-bold leading-tight text-ink shadow-brutal-sm peer-checked:bg-ink peer-checked:text-white peer-disabled:opacity-50 peer-focus-visible:outline-[3px] peer-focus-visible:outline-offset-[3px] peer-focus-visible:outline-ink peer-focus-visible:shadow-[0_0_0_6px_#ffe600]
```
(no `uppercase`, `leading-tight` instead of `leading-none`, `text-base` instead of `text-sm`).

`src/client/components/ConnectionStatus.tsx` — replace `MAP` with:
```ts
const MAP: Record<ConnKind, { glyph: string; text: string; tone: BadgeTone }> = {
  connected: { glyph: '●', text: 'Connected', tone: 'lime' },
  'camera-ready': { glyph: '●', text: 'Camera ready', tone: 'yellow' },
  waiting: { glyph: '●', text: 'Waiting for your partner', tone: 'blue' },
  connecting: { glyph: '●', text: 'Connecting…', tone: 'paper' },
  reconnecting: { glyph: '●', text: 'Reconnecting…', tone: 'orange' },
  lost: { glyph: '!', text: 'Connection lost', tone: 'orange' },
}
```

`src/client/components/BoothHeader.tsx` — replace the whole returned JSX with (the imports and props stay):
```tsx
  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-2 border-b-4 border-ink pb-3">
        <p className="text-lg font-black">Room {formatRoomCode(code)}</p>
        <ConnectionStatus kind={status} />
        <BrutalButton tone="paper" onClick={() => (hasPhotos ? setConfirming(true) : void navigate('/'))}>
          Leave
        </BrutalButton>
      </header>
      <BrutalModal open={confirming} onClose={() => setConfirming(false)} title="Leave the booth?">
        <p className="text-lg font-bold leading-snug">Your photos live only in this tab. Download your strip first.</p>
        <div className="mt-4 flex flex-wrap gap-3">
          <BrutalButton tone="lime" onClick={() => setConfirming(false)}>
            Stay
          </BrutalButton>
          <BrutalButton tone="pink" onClick={() => void navigate('/')}>
            Leave anyway
          </BrutalButton>
        </div>
      </BrutalModal>
    </>
  )
```

- [ ] **Step 6: The stepper, the action bar and the shell**

Create `src/client/components/Stepper.tsx`:
```tsx
import type { Step } from '../../shared/plan'
import { stepperItems } from '../lib/labels'

interface Props {
  step: Step
  /** A sequence is running: nothing can be tapped. */
  running: boolean
  /** The plan accepts changes right now (two people present, no shot in flight). */
  canEdit: boolean
  onGo: (to: Step) => void
}

/** Frame · Shoot · Pick · Style · Done. A bar per step; finished steps are buttons that go back. */
export function Stepper({ step, running, canEdit, onGo }: Props) {
  return (
    <nav aria-label="Progress">
      <ol className="m-0 flex list-none gap-1.5 p-0">
        {stepperItems(step, running).map((item) => (
          <li key={item.step} aria-current={item.state === 'current' ? 'step' : undefined} className="flex flex-1 flex-col gap-1">
            <span aria-hidden="true" className={`block h-2 border-[3px] border-ink ${item.state === 'todo' ? 'bg-paper' : 'bg-ink'}`} />
            {item.tappable ? (
              <button
                type="button"
                disabled={!canEdit}
                onClick={() => onGo(item.step)}
                className="min-h-11 text-left text-sm font-bold underline decoration-2 underline-offset-4 disabled:no-underline disabled:opacity-60"
              >
                {item.label}
                <span className="sr-only"> (go back)</span>
              </button>
            ) : (
              <span className={`min-h-11 text-sm ${item.state === 'current' ? 'font-black' : 'font-medium opacity-60'}`}>{item.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  )
}
```

Create `src/client/components/ActionBar.tsx`:
```tsx
import type { ReactNode } from 'react'

interface Props {
  /** The one primary button. */
  children: ReactNode
  /** A quiet "Back" under the primary button. */
  back?: { onClick: () => void; disabled?: boolean }
}

/** Pinned to the bottom of the screen: one primary action, an unobtrusive Back. Sticks inside the page's <main>. */
export function ActionBar({ children, back }: Props) {
  return (
    <div
      data-testid="action-bar"
      className="sticky bottom-0 z-20 -mx-4 mt-auto flex flex-col gap-2 border-t-4 border-ink bg-paper px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]"
    >
      {children}
      {back && (
        <button
          type="button"
          disabled={back.disabled}
          onClick={back.onClick}
          className="min-h-11 self-center px-3 text-base font-bold underline decoration-2 underline-offset-4 disabled:no-underline disabled:opacity-60"
        >
          Back
        </button>
      )}
    </div>
  )
}
```

Create `src/client/components/WizardShell.tsx`:
```tsx
import { useEffect, useRef, type ReactNode } from 'react'
import { STEPS, type Step } from '../../shared/plan'
import { STEP_LABEL, stepIndex } from '../lib/labels'
import { ActionBar } from './ActionBar'
import { BoothHeader } from './BoothHeader'
import type { ConnKind } from './ConnectionStatus'
import { Stepper } from './Stepper'

/** What every wizard screen needs from the booth page. `canEdit` = the plan accepts changes right now. */
export interface ShellInfo {
  code: string
  status: ConnKind
  hasPhotos: boolean
  running: boolean
  canEdit: boolean
  onGo: (to: Step) => void
}

interface Props extends ShellInfo {
  /** The wizard step this screen shows; null before the wizard starts (the room-code screen). */
  step: Step | null
  title: string
  lead?: string
  wide?: boolean
  /** The one primary button, pinned to the bottom. No primary, no bar. */
  primary?: ReactNode
  /** Hide the Back link (a screen with nothing sensible to go back to). */
  backless?: boolean
  children?: ReactNode
}

export function WizardShell({ code, status, hasPhotos, running, canEdit, onGo, step, title, lead, wide = false, primary, backless = false, children }: Props) {
  const heading = useRef<HTMLHeadingElement>(null)
  // A new step (or a new screen state) starts at its heading: keyboard and screen-reader users land where the content begins.
  useEffect(() => {
    heading.current?.focus({ preventScroll: true })
  }, [step, title])

  const at = step === null ? -1 : stepIndex(step)
  const previous = at > 0 ? STEPS[at - 1] : undefined
  const back = previous && !backless && !running ? { onClick: () => onGo(previous), disabled: !canEdit } : undefined

  return (
    <main className={`mx-auto flex min-h-dvh w-full flex-col gap-5 px-4 pt-4 ${wide ? 'max-w-3xl' : 'max-w-xl'}`}>
      <BoothHeader code={code} status={status} hasPhotos={hasPhotos} />
      {step && <Stepper step={step} running={running} canEdit={canEdit} onGo={onGo} />}
      {step && (
        <p role="status" className="sr-only">
          {`Step ${at + 1} of ${STEPS.length}: ${STEP_LABEL[step]}`}
        </p>
      )}
      <div className="flex flex-col gap-2">
        <h1 ref={heading} tabIndex={-1} className="text-3xl font-black leading-tight outline-none sm:text-4xl">
          {title}
        </h1>
        {lead && <p className="text-lg">{lead}</p>}
      </div>
      {children}
      {primary ? <ActionBar back={back}>{primary}</ActionBar> : <div aria-hidden="true" className="pb-4" />}
    </main>
  )
}
```

- [ ] **Step 7: Run the tests**

Run: `npx vitest run src/client`
Expected: PASS (labels, takes, the shell tests, and the existing client lib tests; `style-rules.test.ts` too).

- [ ] **Step 8: Static checks**

Run: `npm run lint` — expected exit 0.
Run the gate's filtered `tsc` command (see the phase header) — expected `no errors in this phase's files`.

- [ ] **Step 9: Commit**

```bash
git add src/client/test-render.tsx src/client/lib/labels.ts src/client/lib/labels.test.ts \
  src/client/components/Stepper.tsx src/client/components/ActionBar.tsx src/client/components/WizardShell.tsx src/client/components/WizardShell.test.tsx \
  src/client/components/BrutalButton.tsx src/client/components/BrutalBadge.tsx src/client/components/BrutalRadioGroup.tsx \
  src/client/components/ConnectionStatus.tsx src/client/components/BoothHeader.tsx
git commit -m "feat: add the wizard shell, stepper and bottom action bar"
```

---

## Task 5: Room and Frame screens

**Files:**
- Create: `src/client/components/CodeTiles.tsx`, `src/client/screens/RoomScreen.tsx`, `src/client/screens/RoomScreen.test.tsx`, `src/client/screens/FrameScreen.tsx`, `src/client/screens/FrameScreen.test.tsx`

**Interfaces:**
- Consumes: `WizardShell`, `ShellInfo` (Task 4); `render`, `buttonNamed`, `buttons`, `radios` (Task 4); `TEMPLATE_LABEL` (`lib/labels`); `TemplateDiagram` (existing); `Plan`, `PlanAction`, `TEMPLATE_IDS`, `defaultPlan`, `applyPlanAction` (`shared/plan`).
- Produces:
  - `CodeTiles({ code }: { code: string })`
  - `RoomScreen({ shell, shareUrl, partnerLeft }: { shell: ShellInfo; shareUrl: string; partnerLeft: boolean })`
  - `FrameScreen({ shell, plan, onPlan }: { shell: ShellInfo; plan: Plan; onPlan: (action: PlanAction) => void })` — its primary "Next" calls `shell.onGo('shoot')`.

- [ ] **Step 1: Failing tests**

Create `src/client/screens/RoomScreen.test.tsx`:
```tsx
import { describe, expect, it } from 'vitest'
import type { ShellInfo } from '../components/WizardShell'
import { buttonNamed, render } from '../test-render'
import { RoomScreen } from './RoomScreen'

const shell: ShellInfo = { code: 'ABCDEF', status: 'waiting', hasPhotos: false, running: false, canEdit: false, onGo: () => {} }
const room = (partnerLeft = false) => render(<RoomScreen shell={shell} shareUrl="https://booth.test/b/ABCDEF" partnerLeft={partnerLeft} />)

describe('RoomScreen', () => {
  it('asks you to send the code, shows it, and waits', () => {
    const html = room()
    expect(html).toMatch(/<h1[^>]*>Send this code to your partner<\/h1>/)
    expect(html).toContain('They type it in, or open your link.')
    expect(html).toContain('Room code A B C D E F')
    expect(html).toContain('Waiting for your partner…')
  })

  it('shows the six characters as separate tiles', () => {
    const html = room()
    for (const ch of 'ABCDEF') expect(html).toContain(`>${ch}</span>`)
  })

  it('offers to copy the link and to show a QR code; Share only appears where the browser can share', () => {
    const html = room()
    expect(buttonNamed(html, 'Copy link')?.disabled).toBe(false)
    expect(buttonNamed(html, 'QR code')?.disabled).toBe(false)
    expect(buttonNamed(html, 'Share')).toBeUndefined() // the test environment has no navigator.share
    expect(html).toContain('value="https://booth.test/b/ABCDEF"')
  })

  it('has no stepper and no action bar: nothing to decide yet', () => {
    const html = room()
    expect(html).not.toContain('aria-label="Progress"')
    expect(html).not.toContain('data-testid="action-bar"')
  })

  it('says so when the partner was here and has gone', () => {
    expect(room(false)).not.toContain('They left')
    expect(room(true)).toContain('They left :(')
    expect(room(true)).toContain('Waiting for them to come back.')
  })
})
```

Create `src/client/screens/FrameScreen.test.tsx`:
```tsx
import { describe, expect, it } from 'vitest'
import { applyPlanAction, defaultPlan, TEMPLATE_IDS, type Plan } from '../../shared/plan'
import type { ShellInfo } from '../components/WizardShell'
import { buttonNamed, radios, render } from '../test-render'
import { FrameScreen } from './FrameScreen'

const shell: ShellInfo = { code: 'ABCDEF', status: 'connected', hasPhotos: false, running: false, canEdit: true, onGo: () => {} }
const chosen = (): Plan => applyPlanAction(defaultPlan(), { k: 'template', template: 'duo2' }) ?? defaultPlan()
const frame = (plan: Plan, over: Partial<ShellInfo> = {}) => render(<FrameScreen shell={{ ...shell, ...over }} plan={plan} onPlan={() => {}} />)

describe('FrameScreen', () => {
  it('asks for a size and says either person can choose', () => {
    const html = frame(defaultPlan())
    expect(html).toMatch(/<h1[^>]*>Pick a size<\/h1>/)
    expect(html).toContain('Tap one. Either of you can choose.')
  })

  it('offers every size as a native radio, none chosen at first', () => {
    const options = radios(frame(defaultPlan()))
    expect(options.map((o) => o.value)).toEqual([...TEMPLATE_IDS])
    expect(options.every((o) => o.name === 'template' && !o.checked && !o.disabled)).toBe(true)
  })

  it('checks the size the plan has, whoever chose it', () => {
    expect(radios(frame(chosen())).filter((o) => o.checked).map((o) => o.value)).toEqual(['duo2'])
  })

  it('Next waits for a size', () => {
    expect(buttonNamed(frame(defaultPlan()), 'Next')?.disabled).toBe(true)
    expect(buttonNamed(frame(chosen()), 'Next')?.disabled).toBe(false)
  })

  it('greys everything out while the plan cannot change', () => {
    const html = frame(chosen(), { canEdit: false })
    expect(radios(html).every((o) => o.disabled)).toBe(true)
    expect(buttonNamed(html, 'Next')?.disabled).toBe(true)
  })

  it('is the first step: no Back, and the stepper shows Frame as current', () => {
    const html = frame(defaultPlan())
    expect(buttonNamed(html, 'Back')).toBeUndefined()
    expect(html).toContain('Step 1 of 5: Frame')
  })

  it('names each size in plain sentence case', () => {
    const html = frame(defaultPlan())
    for (const text of ['4 cut', '2 × 2', '2 cut', 'Polaroid']) expect(html).toContain(text)
  })
})
```
Run: `npx vitest run src/client/screens/RoomScreen.test.tsx src/client/screens/FrameScreen.test.tsx`
Expected: FAIL — the screens do not exist.

- [ ] **Step 2: Implement `CodeTiles`**

Create `src/client/components/CodeTiles.tsx`:
```tsx
/** The room code as six big tiles. Screen readers get the spaced-out code instead of six separate characters. */
export function CodeTiles({ code }: { code: string }) {
  return (
    <p className="m-0">
      <span className="sr-only">Room code {code.split('').join(' ')}</span>
      <span aria-hidden="true" className="flex justify-center gap-2">
        {code.split('').map((ch, i) => (
          <span
            key={i}
            className="grid h-16 w-12 place-items-center border-4 border-ink bg-white text-4xl font-black shadow-brutal-sm sm:h-20 sm:w-16 sm:text-5xl"
          >
            {ch}
          </span>
        ))}
      </span>
    </p>
  )
}
```

- [ ] **Step 3: Implement `RoomScreen`**

Create `src/client/screens/RoomScreen.tsx`:
```tsx
import QRCode from 'qrcode'
import { useEffect, useState } from 'react'
import { APP_NAME } from '../../shared/constants'
import { BrutalButton } from '../components/BrutalButton'
import { BrutalCard } from '../components/BrutalCard'
import { BrutalModal } from '../components/BrutalModal'
import { useToast } from '../components/BrutalToast'
import { CodeTiles } from '../components/CodeTiles'
import { WizardShell, type ShellInfo } from '../components/WizardShell'

interface Props {
  shell: ShellInfo
  shareUrl: string
  /** Someone was here and has gone: say so above the wait message. */
  partnerLeft: boolean
}

const canShare = (): boolean => typeof navigator !== 'undefined' && typeof navigator.share === 'function'

/** The first screen of a booth: the code, ways to send it, and a wait. It needs no camera. */
export function RoomScreen({ shell, shareUrl, partnerLeft }: Props) {
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
      toast('Link copied')
    } catch {
      toast("Couldn't copy. Select the link.")
    }
  }
  async function share() {
    try {
      await navigator.share({ title: APP_NAME, text: 'Join me in the photo booth.', url: shareUrl })
    } catch {
      // the person closed the share sheet: nothing to report
    }
  }

  return (
    <WizardShell {...shell} step={null} title="Send this code to your partner" lead="They type it in, or open your link.">
      <CodeTiles code={shell.code} />
      <input
        readOnly
        value={shareUrl}
        aria-label="Booth link"
        onFocus={(e) => e.currentTarget.select()}
        className="w-full border-[3px] border-ink bg-white px-3 py-3 text-base font-bold"
      />
      <div className="flex flex-wrap gap-3">
        <BrutalButton tone="yellow" onClick={() => void copy()}>
          Copy link
        </BrutalButton>
        {canShare() && (
          <BrutalButton tone="paper" onClick={() => void share()}>
            Share
          </BrutalButton>
        )}
        <BrutalButton tone="paper" onClick={() => setQrOpen(true)}>
          QR code
        </BrutalButton>
      </div>
      {partnerLeft && (
        <BrutalCard tone="orange" className="p-3" role="status">
          <p className="text-2xl font-black leading-none">They left :(</p>
          <p className="font-bold">Waiting for them to come back.</p>
        </BrutalCard>
      )}
      <p role="status" className="text-xl font-black">
        Waiting for your partner…
      </p>
      <BrutalModal open={qrOpen} onClose={() => setQrOpen(false)} title="Scan to join">
        {qr ? (
          <img src={qr} alt="QR code for this booth" className="mx-auto block w-full max-w-72 border-4 border-ink" />
        ) : (
          <p className="font-bold">Drawing…</p>
        )}
      </BrutalModal>
    </WizardShell>
  )
}
```

- [ ] **Step 4: Implement `FrameScreen`**

Create `src/client/screens/FrameScreen.tsx`:
```tsx
import { TEMPLATE_IDS, type Plan, type PlanAction } from '../../shared/plan'
import { BrutalButton } from '../components/BrutalButton'
import { TemplateDiagram } from '../components/TemplateDiagram'
import { WizardShell, type ShellInfo } from '../components/WizardShell'
import { TEMPLATE_LABEL } from '../lib/labels'

interface Props {
  shell: ShellInfo
  plan: Plan
  onPlan: (action: PlanAction) => void
}

/** Step 1: one decision — the size of the strip. Either person's tap changes it for both. */
export function FrameScreen({ shell, plan, onPlan }: Props) {
  return (
    <WizardShell
      {...shell}
      step="frame"
      title="Pick a size"
      lead="Tap one. Either of you can choose."
      primary={
        <BrutalButton tone="yellow" size="xl" className="w-full" disabled={plan.template === null || !shell.canEdit} onClick={() => shell.onGo('shoot')}>
          Next
        </BrutalButton>
      }
    >
      <fieldset className="m-0 border-0 p-0">
        <legend className="sr-only">Size</legend>
        <div className="grid grid-cols-2 gap-3">
          {TEMPLATE_IDS.map((id) => (
            <label key={id} className="relative">
              <input
                type="radio"
                name="template"
                value={id}
                checked={plan.template === id}
                disabled={!shell.canEdit}
                onChange={() => onPlan({ k: 'template', template: id })}
                className="peer absolute inset-0 m-0 cursor-pointer opacity-0 disabled:cursor-not-allowed"
              />
              <span className="flex h-full flex-col items-center gap-3 border-[3px] border-ink bg-paper p-4 text-center shadow-brutal-sm peer-checked:bg-yellow peer-disabled:opacity-60 peer-focus-visible:outline-[3px] peer-focus-visible:outline-offset-[3px] peer-focus-visible:outline-ink">
                <TemplateDiagram template={id} />
                <span className="text-xl font-black leading-none">{TEMPLATE_LABEL[id].title}</span>
                <span className="text-sm font-medium">{TEMPLATE_LABEL[id].sub}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
    </WizardShell>
  )
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/client/screens`
Expected: PASS (both files). If a `toContain` on markup fails only because React escaped a character (`…` stays literal; `'` becomes `&#x27;` in text), assert on the escaped form — do not change the copy.

- [ ] **Step 6: Static checks and commit**

Run: `npm run lint` (exit 0) and the gate's filtered `tsc` command (expect the echo).
```bash
git add src/client/components/CodeTiles.tsx src/client/screens/RoomScreen.tsx src/client/screens/RoomScreen.test.tsx src/client/screens/FrameScreen.tsx src/client/screens/FrameScreen.test.tsx
git commit -m "feat: add the room code and frame size screens"
```

---

## Task 6: Shoot screen — late camera permission, live frames, the one "I'm ready"

**Files:**
- Create: `src/client/components/LiveFrame.tsx`, `src/client/screens/ShootScreen.tsx`, `src/client/screens/ShootScreen.test.tsx`
- Modify: `src/client/components/Countdown.tsx`

**Interfaces:**
- Consumes: `WizardShell`, `ShellInfo` (Task 4); `shotLabel` (Task 4); `Countdown` (existing); `Plan`, `defaultPlan`; `PState` (`shared/protocol`, now with `camera`); `MAX_MISSES` (`shared/constants`).
- Produces:
  - `LiveFrame({ stream, label, mirrored, testId, videoRef?, offText, children? })`
  - `ShootScreen(props: ShootProps)` with
    ```ts
    interface ShootProps {
      shell: ShellInfo
      plan: Plan
      /** This device's camera, once allowed. */
      stream: MediaStream | null
      mirrored: boolean
      canFlip: boolean
      onAllowCamera: () => void
      onFlip: () => void
      localVideoRef: RefObject<HTMLVideoElement | null>
      remoteStream: MediaStream | null
      remoteMirrored: boolean
      me: PState | null
      partner: PState | null
      /** The call is up, the data channel is open and the clock is synced: a shot can be timed. */
      linkReady: boolean
      onReady: (ready: boolean) => void
      countdown: { captureAt: number } | null
      now: () => number
      onCountdownDone: () => void
      /** This device could not take its photo in the current shot. */
      missed: boolean
      /** The shot's photos are still being exchanged. */
      exchanging: boolean
      /** This device has taken its photo in the current shot. */
      captured: boolean
    }
    ```
  - `data-testid` values kept for e2e: `local-video`, `remote-video`, `countdown`.

- [ ] **Step 1: Failing tests**

Create `src/client/screens/ShootScreen.test.tsx`:
```tsx
import { describe, expect, it } from 'vitest'
import { MAX_MISSES } from '../../shared/constants'
import { defaultPlan, type Plan } from '../../shared/plan'
import type { PState } from '../../shared/protocol'
import type { ShellInfo } from '../components/WizardShell'
import { buttonNamed, render } from '../test-render'
import { ShootScreen } from './ShootScreen'

const shell: ShellInfo = { code: 'ABCDEF', status: 'connected', hasPhotos: false, running: false, canEdit: true, onGo: () => {} }
const slots = [{ shot: null, kind: 'both' as const }, { shot: null, kind: 'both' as const }]
const idle: Plan = { ...defaultPlan(), step: 'shoot', template: 'duo2', slots }
const state = (over: Partial<PState> = {}): PState => ({ connected: true, ready: false, photoDone: false, camera: true, ...over })
const stream = {} as MediaStream // the screen only checks it is there; the <video> wiring happens in an effect

const screen = (over: Partial<Parameters<typeof ShootScreen>[0]> = {}) =>
  render(
    <ShootScreen
      shell={shell}
      plan={idle}
      stream={stream}
      mirrored
      canFlip={false}
      onAllowCamera={() => {}}
      onFlip={() => {}}
      localVideoRef={{ current: null }}
      remoteStream={null}
      remoteMirrored
      me={state()}
      partner={state()}
      linkReady
      onReady={() => {}}
      countdown={null}
      now={() => 0}
      onCountdownDone={() => {}}
      missed={false}
      exchanging={false}
      captured={false}
      {...over}
    />,
  )

describe('ShootScreen — before the camera is on', () => {
  const html = screen({ stream: null, me: state({ camera: false }) })
  it('asks for the camera with one friendly sentence, and nothing else to decide', () => {
    expect(html).toMatch(/<h1[^>]*>Allow your camera<\/h1>/)
    expect(html).toContain('Your camera stays in your browser. Photos are made on your device.')
    expect(buttonNamed(html, 'Allow camera')?.disabled).toBe(false)
  })
  it('shows no live frames and no ready button yet', () => {
    expect(html).not.toContain('data-testid="local-video"')
    expect(buttonNamed(html, "I'm ready")).toBeUndefined()
  })
})

describe('ShootScreen — waiting for the other camera and the call', () => {
  it('shows both frames, and waits while the partner has no camera', () => {
    const html = screen({ partner: state({ camera: false }) })
    expect(html).toContain('data-testid="local-video"')
    expect(html).toContain('data-testid="remote-video"')
    expect(html).toContain('Waiting for their camera…')
    const wait = buttonNamed(html, 'Waiting for your partner…')
    expect(wait?.disabled).toBe(true)
  })
  it('waits while the call is still connecting', () => {
    const html = screen({ linkReady: false })
    expect(buttonNamed(html, 'Connecting…')?.disabled).toBe(true)
  })
})

describe('ShootScreen — ready to go', () => {
  it('has one enabled primary button: I\'m ready', () => {
    const html = screen()
    expect(html).toMatch(/<h1[^>]*>Ready to shoot\?<\/h1>/)
    expect(buttonNamed(html, "I'm ready")?.disabled).toBe(false)
  })
  it('after pressing it, says it is waiting for the partner and lets you take it back', () => {
    const html = screen({ me: state({ ready: true }) })
    const pressed = buttonNamed(html, 'Waiting for your partner…')
    expect(pressed?.disabled).toBe(false)
    expect(pressed?.attrs).toContain('aria-pressed="true"')
  })
  it('is blocked while the plan cannot change (the socket is reconnecting)', () => {
    expect(buttonNamed(screen({ shell: { ...shell, canEdit: false } }), "I'm ready")?.disabled).toBe(true)
  })
  it('shows who is ready', () => {
    const html = screen({ partner: state({ ready: true }) })
    expect(html).toContain('You: not ready')
    expect(html).toContain('Partner: ready ✓')
  })
  it('offers to flip the camera only when the device has two', () => {
    expect(buttonNamed(screen({ canFlip: false }), 'Flip camera')).toBeUndefined()
    expect(buttonNamed(screen({ canFlip: true }), 'Flip camera')?.disabled).toBe(false)
  })
  it('has a Back link while idle', () => {
    expect(buttonNamed(screen(), 'Back')?.disabled).toBe(false)
  })
})

describe('ShootScreen — while the sequence runs', () => {
  const running: Plan = { ...idle, running: true, target: 6, shots: [1] }
  it('shows which shot it is on, and nothing to press', () => {
    const html = screen({ plan: running, shell: { ...shell, running: true } })
    expect(html).toContain('Shot 2 of 6')
    expect(buttonNamed(html, "I'm ready")).toBeUndefined()
    expect(buttonNamed(html, 'Shooting…')?.disabled).toBe(true)
  })
  it('cannot go back or flip the camera mid-sequence', () => {
    const html = screen({ plan: running, shell: { ...shell, running: true }, canFlip: true })
    expect(buttonNamed(html, 'Back')).toBeUndefined()
    expect(buttonNamed(html, 'Flip camera')).toBeUndefined()
  })
  it('shows the countdown over the frames', () => {
    const html = screen({ plan: running, shell: { ...shell, running: true }, countdown: { captureAt: 3000 } })
    expect(html).toContain('data-testid="countdown"')
  })
  it('says what it is waiting for once the shot is taken', () => {
    const base = { plan: running, shell: { ...shell, running: true }, exchanging: true }
    expect(screen({ ...base, captured: false })).toContain('Waiting for the photos…')
    expect(screen({ ...base, captured: true })).toContain('Got yours. Waiting for their photo…')
  })
  // Review Focus 3
  it('tells the person when their own photo could not be taken', () => {
    expect(screen({ plan: running, shell: { ...shell, running: true }, missed: true })).toContain('Missed that one. The next shot is coming.')
  })
})

// Review Focus 3: a sequence that gave up with too few shots says so, and lets them go again.
describe('ShootScreen — after a failed sequence', () => {
  const failed: Plan = { ...idle, misses: MAX_MISSES, shots: [1] }
  it("says it didn't work and offers I'm ready again", () => {
    const html = screen({ plan: failed })
    expect(html).toContain("That didn&#x27;t work. Go again.")
    expect(buttonNamed(html, "I'm ready")?.disabled).toBe(false)
  })
  it('does not say it when the shots are enough (the sequence went on to Pick)', () => {
    const enough: Plan = { ...idle, misses: MAX_MISSES, shots: [1, 2, 3] }
    expect(screen({ plan: enough })).not.toContain('Go again')
  })
})
```
Run: `npx vitest run src/client/screens/ShootScreen.test.tsx`
Expected: FAIL — `./ShootScreen` does not exist.

- [ ] **Step 2: Calmer countdown copy**

In `src/client/components/Countdown.tsx` change the two strings: `BOTH READY. GET READY.` → `Get ready…`, and `SNAP!` → `Snap!`. Replace the get-ready `<p>`'s class `... text-2xl font-black uppercase shadow-brutal sm:text-4xl` by `... text-2xl font-black shadow-brutal sm:text-4xl` (drop `uppercase`). Nothing else changes (the numerals, `data-testid`, timing and `aria-live` stay).

- [ ] **Step 3: `LiveFrame`**

Create `src/client/components/LiveFrame.tsx`:
```tsx
import { useEffect, useRef, type ReactNode, type RefObject } from 'react'

interface Props {
  stream: MediaStream | null
  label: string
  mirrored: boolean
  testId: string
  videoRef?: RefObject<HTMLVideoElement | null>
  /** What the frame says while there is no picture yet. */
  offText: string
  children?: ReactNode
}

/** A live camera as a plain framed picture with a caption underneath. Compact on a phone, full width on a wide screen. */
export function LiveFrame({ stream, label, mirrored, testId, videoRef, offText, children }: Props) {
  const own = useRef<HTMLVideoElement>(null)
  const ref = videoRef ?? own
  useEffect(() => {
    const video = ref.current
    if (!video) return
    video.srcObject = stream
    if (stream) void video.play().catch(() => {})
  }, [stream, ref])

  return (
    <figure className="m-0 flex flex-col gap-1">
      <div className="relative mx-auto aspect-[4/3] w-[min(100%,calc(28dvh_*_4/3))] overflow-hidden border-[3px] border-ink bg-ink shadow-brutal-sm sm:w-full">
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
        {!stream && <p className="absolute inset-0 grid place-items-center p-3 text-center text-sm font-bold text-paper">{offText}</p>}
        {children}
      </div>
      <figcaption className="text-center text-sm font-bold">{label}</figcaption>
    </figure>
  )
}
```

- [ ] **Step 4: `ShootScreen`**

Create `src/client/screens/ShootScreen.tsx`:
```tsx
import type { ReactNode, RefObject } from 'react'
import { MAX_MISSES } from '../../shared/constants'
import type { Plan } from '../../shared/plan'
import type { PState } from '../../shared/protocol'
import { BrutalBadge } from '../components/BrutalBadge'
import { BrutalButton } from '../components/BrutalButton'
import { BrutalCard } from '../components/BrutalCard'
import { Countdown } from '../components/Countdown'
import { LiveFrame } from '../components/LiveFrame'
import { WizardShell, type ShellInfo } from '../components/WizardShell'
import { shotLabel } from '../lib/labels'

interface Props {
  shell: ShellInfo
  plan: Plan
  /** This device's camera, once allowed. */
  stream: MediaStream | null
  mirrored: boolean
  canFlip: boolean
  onAllowCamera: () => void
  onFlip: () => void
  localVideoRef: RefObject<HTMLVideoElement | null>
  remoteStream: MediaStream | null
  remoteMirrored: boolean
  me: PState | null
  partner: PState | null
  /** The call is up, the data channel is open and the clock is synced: a shot can be timed. */
  linkReady: boolean
  onReady: (ready: boolean) => void
  countdown: { captureAt: number } | null
  now: () => number
  onCountdownDone: () => void
  /** This device could not take its photo in the current shot. */
  missed: boolean
  /** The shot's photos are still being exchanged. */
  exchanging: boolean
  /** This device has taken its photo in the current shot. */
  captured: boolean
}

/** Step 2: allow the camera, see each other, press "I'm ready" once; the shots then follow by themselves. */
export function ShootScreen(p: Props) {
  const { plan } = p
  const cameraOn = p.stream !== null
  const partnerCamera = p.partner?.camera ?? false
  const iAmReady = p.me?.ready ?? false
  const partnerReady = p.partner?.ready ?? false
  // The sequence gave up (too many skipped shots) before there were enough photos for the frames.
  const failed = !plan.running && plan.misses >= MAX_MISSES && plan.shots.length < plan.slots.length

  let primary: ReactNode
  if (!cameraOn) {
    primary = (
      <BrutalButton tone="yellow" size="xl" className="w-full" onClick={p.onAllowCamera}>
        Allow camera
      </BrutalButton>
    )
  } else if (plan.running) {
    primary = (
      <BrutalButton tone="ink" size="xl" className="w-full" disabled>
        Shooting…
      </BrutalButton>
    )
  } else {
    const label = iAmReady || !partnerCamera ? 'Waiting for your partner…' : !p.linkReady ? 'Connecting…' : "I'm ready"
    primary = (
      <BrutalButton
        tone={iAmReady ? 'ink' : 'yellow'}
        size="xl"
        className="w-full"
        aria-pressed={iAmReady}
        disabled={!iAmReady && (!partnerCamera || !p.linkReady || !p.shell.canEdit)}
        onClick={() => p.onReady(!iAmReady)}
      >
        {label}
      </BrutalButton>
    )
  }

  let progress = ''
  if (plan.running) {
    progress = shotLabel(plan)
    if (!p.countdown) {
      progress += p.exchanging ? ` · ${p.captured ? 'Got yours. Waiting for their photo…' : 'Waiting for the photos…'}` : ' · Get ready…'
    }
  }

  return (
    <WizardShell
      {...p.shell}
      step="shoot"
      wide
      title={cameraOn ? 'Ready to shoot?' : 'Allow your camera'}
      lead={cameraOn ? undefined : 'Your camera stays in your browser. Photos are made on your device.'}
      primary={primary}
    >
      {cameraOn && (
        <>
          <div className="relative">
            <div className="grid gap-3 sm:grid-cols-2">
              <LiveFrame stream={p.stream} label="You" mirrored={p.mirrored} testId="local-video" videoRef={p.localVideoRef} offText="Your camera is off" />
              <LiveFrame stream={p.remoteStream} label="Your partner" mirrored={p.remoteMirrored} testId="remote-video" offText={partnerCamera ? 'Connecting…' : 'Waiting for their camera…'} />
            </div>
            {p.countdown && <Countdown captureAt={p.countdown.captureAt} now={p.now} onDone={p.onCountdownDone} />}
          </div>

          {p.canFlip && !plan.running && (
            <BrutalButton tone="paper" className="self-start" onClick={p.onFlip}>
              Flip camera
            </BrutalButton>
          )}

          {!plan.running && (
            <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
              <li>
                <BrutalBadge tone={iAmReady ? 'lime' : 'paper'}>{`You: ${iAmReady ? 'ready ✓' : 'not ready'}`}</BrutalBadge>
              </li>
              <li>
                <BrutalBadge tone={partnerReady ? 'lime' : 'paper'}>{`Partner: ${partnerCamera ? (partnerReady ? 'ready ✓' : 'not ready') : 'camera off'}`}</BrutalBadge>
              </li>
            </ul>
          )}

          {progress && (
            <p role="status" className="text-xl font-black">
              {progress}
            </p>
          )}
          {plan.running && p.missed && (
            <BrutalCard tone="orange" role="status" className="p-3 text-lg font-bold">
              Missed that one. The next shot is coming.
            </BrutalCard>
          )}
          {failed && (
            <BrutalCard tone="orange" role="status" className="p-3 text-lg font-bold">
              That didn't work. Go again.
            </BrutalCard>
          )}
        </>
      )}
    </WizardShell>
  )
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/client/screens/ShootScreen.test.tsx`
Expected: PASS. (React escapes `'` as `&#x27;` in text nodes; the test for the failure copy already uses that form. For a `toContain` on text with `'` elsewhere, do the same.)

- [ ] **Step 6: Static checks and commit**

Run: `npx vitest run src/client` (the style rules must stay green), `npm run lint`, and the gate's filtered `tsc` command.
```bash
git add src/client/components/LiveFrame.tsx src/client/components/Countdown.tsx src/client/screens/ShootScreen.tsx src/client/screens/ShootScreen.test.tsx
git commit -m "feat: add the shoot screen with a late camera prompt and a single ready button"
```

---

## Task 7: Pick screen

**Files:**
- Create: `src/client/screens/PickScreen.tsx`, `src/client/screens/PickScreen.test.tsx`

**Interfaces:**
- Consumes: `WizardShell`, `ShellInfo` (Task 4); `BrutalRadioGroup` (restyled, Task 4); `PhotoThumb` (existing); `whoLabel` (Phase 1 Task 3); `TakeStore` (`lib/takes`); `Plan`, `PlanAction`, `CellKind`, `canShootMore` (`shared/plan`); `SlotName`.
- Produces: `PickScreen({ shell, plan, store, mySlot, onPlan }: { shell: ShellInfo; plan: Plan; store: TakeStore; mySlot: SlotName; onPlan: (action: PlanAction) => void })`. Tap a shot (it highlights), then tap a frame → `onPlan({ k: 'fill', slot, shot })`. Who-radios → `onPlan({ k: 'kind', slot, kind })`. "Shoot more" and Back both call `shell.onGo('shoot')`; Next calls `shell.onGo('style')`.

- [ ] **Step 1: Failing tests**

Create `src/client/screens/PickScreen.test.tsx`:
```tsx
import { describe, expect, it } from 'vitest'
import { MAX_SHOTS } from '../../shared/constants'
import { defaultPlan, type Plan } from '../../shared/plan'
import type { ShellInfo } from '../components/WizardShell'
import { putRound, type TakeStore } from '../lib/takes'
import { buttonNamed, buttons, radios, render } from '../test-render'
import { PickScreen } from './PickScreen'

const shell: ShellInfo = { code: 'ABCDEF', status: 'connected', hasPhotos: true, running: false, canEdit: true, onGo: () => {} }
const picked: Plan = {
  ...defaultPlan(),
  step: 'pick',
  template: 'duo2',
  shots: [1, 2, 3, 4],
  target: 4,
  slots: [{ shot: 1, kind: 'both' }, { shot: 2, kind: 'both' }],
}
const store: TakeStore = [1, 2, 3, 4].reduce<TakeStore>((s, n) => putRound(s, { round: n, a: new Blob([`a${n}`]), b: new Blob([`b${n}`]) }), new Map())
const pick = (plan: Plan = picked, over: Partial<ShellInfo> = {}, mySlot: 'a' | 'b' = 'a') =>
  render(<PickScreen shell={{ ...shell, ...over }} plan={plan} store={store} mySlot={mySlot} onPlan={() => {}} />)

describe('PickScreen', () => {
  it('asks you to pick favourites and says how', () => {
    const html = pick()
    expect(html).toMatch(/<h1[^>]*>Pick your favorites<\/h1>/)
    expect(html).toContain('Tap a shot, then a frame.')
    expect(html).toContain('Step 3 of 5: Pick')
  })

  it('lists every shot, saying which frame each one is in', () => {
    const names = buttons(pick()).map((b) => /aria-label="([^"]*)"/.exec(b.attrs)?.[1])
    expect(names).toEqual(expect.arrayContaining(['Shot 1, in frame 1', 'Shot 2, in frame 2', 'Shot 3', 'Shot 4']))
  })

  it('shows each frame with the shot that fills it', () => {
    const names = buttons(pick()).map((b) => /aria-label="([^"]*)"/.exec(b.attrs)?.[1] ?? '')
    expect(names.some((n) => n.startsWith('Frame 1, shot 1'))).toBe(true)
    expect(names.some((n) => n.startsWith('Frame 2, shot 2'))).toBe(true)
  })

  it('shows an empty frame as empty', () => {
    const half: Plan = { ...picked, slots: [{ shot: 1, kind: 'both' }, { shot: null, kind: 'both' }] }
    const html = pick(half)
    expect(html).toContain('Empty')
    expect(html).toContain('Frame 2, empty')
  })

  it('Next waits until every frame has a shot', () => {
    const half: Plan = { ...picked, slots: [{ shot: 1, kind: 'both' }, { shot: null, kind: 'both' }] }
    expect(buttonNamed(pick(half), 'Next')?.disabled).toBe(true)
    expect(buttonNamed(pick(), 'Next')?.disabled).toBe(false)
  })

  // Review Focus 5: "Just you" / "Just them" read from each person's own side, but are stored as USER 1 / USER 2.
  it('offers Both / Just you / Just them for each frame, with the right one checked', () => {
    const plan: Plan = { ...picked, slots: [{ shot: 1, kind: 'a' }, { shot: 2, kind: 'both' }] }
    const html = pick(plan, {}, 'a')
    const who0 = radios(html).filter((r) => r.name === 'who-0')
    expect(who0.map((r) => r.value)).toEqual(['both', 'a', 'b']) // Both, Just you (slot a), Just them (slot b)
    expect(who0.filter((r) => r.checked).map((r) => r.value)).toEqual(['a'])
    for (const label of ['Both', 'Just you', 'Just them']) expect(html).toContain(label)
  })
  it('puts "Just you" on slot b for the other person, so the same frame reads the other way round', () => {
    const plan: Plan = { ...picked, slots: [{ shot: 1, kind: 'a' }, { shot: 2, kind: 'both' }] }
    const who0 = radios(pick(plan, {}, 'b')).filter((r) => r.name === 'who-0')
    expect(who0.map((r) => r.value)).toEqual(['both', 'b', 'a']) // Both, Just you (slot b), Just them (slot a)
    expect(who0.filter((r) => r.checked).map((r) => r.value)).toEqual(['a']) // slot a is "Just them" for person b
  })

  it('"Shoot more" is there until the shot limit', () => {
    expect(buttonNamed(pick(), 'Shoot more')?.disabled).toBe(false)
    const full: Plan = { ...picked, shots: Array.from({ length: MAX_SHOTS }, (_, i) => i + 1) }
    expect(buttonNamed(pick(full), 'Shoot more')?.disabled).toBe(true)
  })

  it('greys out every choice while the plan cannot change', () => {
    const html = pick(picked, { canEdit: false })
    expect(radios(html).every((r) => r.disabled)).toBe(true)
    expect(buttonNamed(html, 'Next')?.disabled).toBe(true)
    expect(buttonNamed(html, 'Shoot more')?.disabled).toBe(true)
  })

  it('has a Back link', () => {
    expect(buttonNamed(pick(), 'Back')?.disabled).toBe(false)
  })
})
```
Run: `npx vitest run src/client/screens/PickScreen.test.tsx`
Expected: FAIL — `./PickScreen` does not exist.

- [ ] **Step 2: Implement `PickScreen`**

Create `src/client/screens/PickScreen.tsx`:
```tsx
import { useState } from 'react'
import { canShootMore, type CellKind, type Plan, type PlanAction } from '../../shared/plan'
import type { SlotName } from '../../shared/protocol'
import { BrutalButton } from '../components/BrutalButton'
import { BrutalRadioGroup } from '../components/BrutalRadioGroup'
import { PhotoThumb } from '../components/PhotoThumb'
import { WizardShell, type ShellInfo } from '../components/WizardShell'
import { whoLabel } from '../lib/labels'
import type { TakeStore } from '../lib/takes'

interface Props {
  shell: ShellInfo
  plan: Plan
  store: TakeStore
  mySlot: SlotName
  onPlan: (action: PlanAction) => void
}

/** Step 3: every shot as a thumbnail; tap a shot, then a frame, to fill it; say who is in each frame. */
export function PickScreen({ shell, plan, store, mySlot, onPlan }: Props) {
  const [selected, setSelected] = useState<number | null>(null)
  const edit = shell.canEdit
  // A shot the plan no longer lists (the partner started over) is not a selection any more.
  const holding = selected !== null && plan.shots.includes(selected) ? selected : null
  const theirs: SlotName = mySlot === 'a' ? 'b' : 'a'
  const kinds: CellKind[] = ['both', mySlot, theirs]
  const frameOf = (shot: number): number => plan.slots.findIndex((s) => s.shot === shot)
  const filled = plan.slots.every((s) => s.shot !== null)

  return (
    <WizardShell
      {...shell}
      step="pick"
      wide
      title="Pick your favorites"
      lead="Tap a shot, then a frame."
      primary={
        <BrutalButton tone="yellow" size="xl" className="w-full" disabled={!filled || !edit} onClick={() => shell.onGo('style')}>
          Next
        </BrutalButton>
      }
    >
      <section aria-labelledby="pick-shots" className="flex flex-col gap-3">
        <h2 id="pick-shots" className="text-xl font-black">
          Your shots
        </h2>
        <ul className="m-0 grid list-none grid-cols-3 gap-3 p-0 sm:grid-cols-4">
          {plan.shots.map((shot, i) => {
            const frame = frameOf(shot)
            const photos = store.get(shot)
            const isSelected = holding === shot
            return (
              <li key={shot}>
                <button
                  type="button"
                  aria-pressed={isSelected}
                  aria-label={`Shot ${i + 1}${frame >= 0 ? `, in frame ${frame + 1}` : ''}`}
                  disabled={!edit}
                  onClick={() => setSelected(isSelected ? null : shot)}
                  className={`block w-full border-[3px] border-ink p-1 shadow-brutal-sm disabled:opacity-60 ${isSelected ? 'bg-yellow' : 'bg-paper'}`}
                >
                  <PhotoThumb kind="both" a={photos?.a} b={photos?.b} />
                  <span className="mt-1 block text-sm font-bold">{frame >= 0 ? `Frame ${frame + 1}` : `Shot ${i + 1}`}</span>
                </button>
              </li>
            )
          })}
        </ul>
        <BrutalButton tone="paper" className="self-start" disabled={!edit || !canShootMore(plan)} onClick={() => shell.onGo('shoot')}>
          Shoot more
        </BrutalButton>
      </section>

      <section aria-labelledby="pick-frames" className="flex flex-col gap-3">
        <h2 id="pick-frames" className="text-xl font-black">
          Your frames
        </h2>
        <p role="status" className="min-h-6 font-bold">
          {holding !== null ? 'Now tap a frame.' : ''}
        </p>
        <ol className="m-0 grid list-none gap-5 p-0 sm:grid-cols-2">
          {plan.slots.map((slot, i) => {
            const photos = slot.shot === null ? undefined : store.get(slot.shot)
            const shotNo = slot.shot === null ? 0 : plan.shots.indexOf(slot.shot) + 1
            return (
              <li key={i} className="flex flex-col gap-3">
                <button
                  type="button"
                  disabled={!edit || holding === null}
                  aria-label={`Frame ${i + 1}, ${slot.shot === null ? 'empty' : `shot ${shotNo}`}${holding !== null ? '. Put the selected shot here' : ''}`}
                  onClick={() => {
                    if (holding === null) return
                    onPlan({ k: 'fill', slot: i, shot: holding })
                    setSelected(null)
                  }}
                  className="block w-full border-[3px] border-ink bg-paper p-1 shadow-brutal-sm disabled:opacity-100"
                >
                  {slot.shot === null ? (
                    <span className="grid aspect-[4/3] place-items-center border-[3px] border-dashed border-ink text-base font-bold">Empty</span>
                  ) : (
                    <PhotoThumb kind={slot.kind} a={photos?.a} b={photos?.b} />
                  )}
                </button>
                <BrutalRadioGroup
                  legend={`Who is in frame ${i + 1}`}
                  name={`who-${i}`}
                  value={slot.kind}
                  onChange={(kind) => onPlan({ k: 'kind', slot: i, kind })}
                  options={kinds.map((k) => ({ value: k, label: whoLabel(k, mySlot), disabled: !edit }))}
                />
              </li>
            )
          })}
        </ol>
      </section>
    </WizardShell>
  )
}
```

- [ ] **Step 3: Run the tests**

Run: `npx vitest run src/client/screens/PickScreen.test.tsx`
Expected: PASS.

- [ ] **Step 4: Static checks and commit**

Run: `npx vitest run src/client`, `npm run lint`, and the gate's filtered `tsc` command.
```bash
git add src/client/screens/PickScreen.tsx src/client/screens/PickScreen.test.tsx
git commit -m "feat: add the pick screen with shot thumbnails, frame slots and who is in each frame"
```

---

## Task 8: Style, Done and lost-photos screens, with the lifted style state

**Files:**
- Create: `src/client/hooks/useStyleState.ts`, `src/client/hooks/useFinishedStrip.ts`, `src/client/screens/StyleScreen.tsx`, `src/client/screens/StyleScreen.test.tsx`, `src/client/screens/DoneScreen.tsx`, `src/client/screens/DoneScreen.test.tsx`, `src/client/screens/LostPhotosScreen.tsx`, `src/client/screens/LostPhotosScreen.test.tsx`
- Modify: `src/client/components/PhotoStrip.tsx`, `src/client/components/BackgroundPicker.tsx`

**Interfaces:**
- Consumes: `WizardShell`, `ShellInfo` (Task 4); `BrutalRadioGroup`, `FilterPicker`, `BackgroundPicker`, `PhotoStrip` (existing / restyled here); `useCutouts` (`CutoutStatus`), `useStrip`, `useToast`; `Finished` (`lib/takes`); `downloadBlob`, `formatStripDate`, `shareImage` (`lib/strip`); `canvasToBlob` (`lib/photo`); `APP_NAME`.
- Produces:
  - `hooks/useStyleState.ts`: `useStyleState()` returning `{ background: BackgroundId; setBackground; filter: FilterId; setFilter; format: 'png' | 'jpg'; setFormat; attempt: number; retryCutouts: () => void }`, and `type StyleState = ReturnType<typeof useStyleState>`. Lives in `Booth.tsx` so the choices survive step changes.
  - `hooks/useFinishedStrip.ts`: `useFinishedStrip(finished: Finished | null, code: string, style: StyleState): FinishedStrip` with
    ```ts
    interface FinishedStrip {
      url: string | null
      error: boolean
      /** The strip is composed: Download and Share can work. */
      ready: boolean
      cutout: CutoutStatus
      /** At least one frame has both people (the background picker only makes sense then). */
      hasTogether: boolean
      download: () => void
      share: () => void
    }
    ```
  - `StyleScreen({ shell, strip, style }: { shell: ShellInfo; strip: FinishedStrip; style: StyleState })` — Next calls `shell.onGo('done')`.
  - `DoneScreen({ shell, strip, style, partnerHere, notice?, onMakeAnother })` with `notice?: { text: string; action: string; onAction: () => void }`.
  - `LostPhotosScreen({ shell, step, onStartOver }: { shell: ShellInfo; step: Step; onStartOver: () => void })`.

- [ ] **Step 1: Failing tests**

Create `src/client/screens/StyleScreen.test.tsx`:
```tsx
import { describe, expect, it } from 'vitest'
import type { ShellInfo } from '../components/WizardShell'
import type { FinishedStrip } from '../hooks/useFinishedStrip'
import type { StyleState } from '../hooks/useStyleState'
import { buttonNamed, radios, render } from '../test-render'
import { StyleScreen } from './StyleScreen'

const shell: ShellInfo = { code: 'ABCDEF', status: 'connected', hasPhotos: true, running: false, canEdit: true, onGo: () => {} }
const style: StyleState = {
  background: 'none',
  setBackground: () => {},
  filter: 'original',
  setFilter: () => {},
  format: 'png',
  setFormat: () => {},
  attempt: 0,
  retryCutouts: () => {},
}
const strip = (over: Partial<FinishedStrip> = {}): FinishedStrip => ({
  url: 'blob:strip',
  error: false,
  ready: true,
  cutout: 'idle',
  hasTogether: true,
  download: () => {},
  share: () => {},
  ...over,
})
const screen = (s: FinishedStrip = strip(), st: StyleState = style) => render(<StyleScreen shell={shell} strip={s} style={st} />)

describe('StyleScreen', () => {
  it('asks for a look, shows the strip, and has one primary: Next', () => {
    const html = screen()
    expect(html).toMatch(/<h1[^>]*>Pick a look<\/h1>/)
    expect(html).toContain('src="blob:strip"')
    expect(buttonNamed(html, 'Next')?.disabled).toBe(false)
    expect(html).toContain('Step 4 of 5: Style')
  })

  it('offers the filters, and the backgrounds only when someone is in a "Both" frame', () => {
    expect(radios(screen(strip({ hasTogether: true }))).some((r) => r.name === 'background')).toBe(true)
    const without = radios(screen(strip({ hasTogether: false })))
    expect(without.some((r) => r.name === 'background')).toBe(false)
    expect(without.some((r) => r.name === 'filter')).toBe(true)
  })

  it('checks the look this person already chose (the choice survives step changes)', () => {
    const html = screen(strip(), { ...style, filter: 'warm', background: 'none' })
    expect(radios(html).filter((r) => r.name === 'filter' && r.checked).map((r) => r.value)).toEqual(['warm'])
  })

  it('says what is happening while a background is being cut out, and when it fell back', () => {
    expect(screen(strip({ cutout: 'loading' }))).toContain('Cutting you out…')
    expect(screen(strip({ cutout: 'failed' }))).toContain('Showing side by side.')
    expect(screen()).toContain('Cutouts are made on your device.')
  })

  it('shows a placeholder while the strip is still being made', () => {
    expect(screen(strip({ url: null, ready: false }))).toContain('Developing…')
  })

  it('has a Back link', () => {
    expect(buttonNamed(screen(), 'Back')?.disabled).toBe(false)
  })
})
```

Create `src/client/screens/DoneScreen.test.tsx`:
```tsx
import { describe, expect, it } from 'vitest'
import type { ShellInfo } from '../components/WizardShell'
import type { FinishedStrip } from '../hooks/useFinishedStrip'
import type { StyleState } from '../hooks/useStyleState'
import { buttonNamed, radios, render } from '../test-render'
import { DoneScreen } from './DoneScreen'

const shell: ShellInfo = { code: 'ABCDEF', status: 'connected', hasPhotos: true, running: false, canEdit: true, onGo: () => {} }
const style: StyleState = {
  background: 'none',
  setBackground: () => {},
  filter: 'original',
  setFilter: () => {},
  format: 'png',
  setFormat: () => {},
  attempt: 0,
  retryCutouts: () => {},
}
const strip = (over: Partial<FinishedStrip> = {}): FinishedStrip => ({
  url: 'blob:strip',
  error: false,
  ready: true,
  cutout: 'idle',
  hasTogether: true,
  download: () => {},
  share: () => {},
  ...over,
})
const done = (over: Partial<Parameters<typeof DoneScreen>[0]> = {}) =>
  render(<DoneScreen shell={shell} strip={strip()} style={style} partnerHere onMakeAnother={() => {}} {...over} />)

describe('DoneScreen', () => {
  it('celebrates, shows the strip and puts Download first', () => {
    const html = done()
    expect(html).toMatch(/<h1[^>]*>All done!<\/h1>/)
    expect(html).toContain('src="blob:strip"')
    expect(buttonNamed(html, 'Download')?.disabled).toBe(false)
    expect(buttonNamed(html, 'Share')?.disabled).toBe(false)
    expect(buttonNamed(html, 'Make another')?.disabled).toBe(false)
  })

  it('cannot download before the strip is composed', () => {
    const html = done({ strip: strip({ url: null, ready: false }) })
    expect(buttonNamed(html, 'Download')?.disabled).toBe(true)
    expect(buttonNamed(html, 'Share')?.disabled).toBe(true)
    expect(buttonNamed(html, 'Make another')?.disabled).toBe(false) // starting over never waits for the strip
  })

  it('offers PNG and JPG, with the chosen one checked', () => {
    const options = radios(done())
    expect(options.map((r) => r.value)).toEqual(['png', 'jpg'])
    expect(options.filter((r) => r.checked).map((r) => r.value)).toEqual(['png'])
  })

  // Review Focus 6
  it('tells you when your partner left, so you save the strip', () => {
    expect(done({ partnerHere: true })).not.toContain('Your partner left')
    expect(done({ partnerHere: false })).toContain('Your partner left. Save your strip before you go.')
  })
  it('keeps the strip and shows a notice when the partner moved the plan on', () => {
    const html = done({ notice: { text: 'Your partner started a new strip. Download yours first.', action: 'Continue', onAction: () => {} } })
    expect(html).toContain('src="blob:strip"')
    expect(html).toContain('Your partner started a new strip. Download yours first.')
    expect(buttonNamed(html, 'Continue')?.disabled).toBe(false)
  })

  it('has a Back link to Style', () => {
    expect(buttonNamed(done(), 'Back')?.disabled).toBe(false)
    expect(done()).toContain('Step 5 of 5: Done')
  })
})
```

Create `src/client/screens/LostPhotosScreen.test.tsx`:
```tsx
import { describe, expect, it } from 'vitest'
import type { ShellInfo } from '../components/WizardShell'
import { buttonNamed, render } from '../test-render'
import { LostPhotosScreen } from './LostPhotosScreen'

const shell: ShellInfo = { code: 'ABCDEF', status: 'connected', hasPhotos: false, running: false, canEdit: true, onGo: () => {} }
const html = render(<LostPhotosScreen shell={shell} step="pick" onStartOver={() => {}} />)

// Review Focus 6: a reloaded tab holds none of the photos the plan points at.
describe('LostPhotosScreen', () => {
  it('says plainly that the photos are gone and why', () => {
    expect(html).toMatch(/<h1[^>]*>Your photos were lost when this page reloaded<\/h1>/)
    expect(html).toContain('They live only in the tab they were taken in.')
  })
  it('offers Start over as the one way forward, and no Back', () => {
    expect(buttonNamed(html, 'Start over')?.disabled).toBe(false)
    expect(buttonNamed(html, 'Back')).toBeUndefined()
  })
  it('keeps the stepper on the step the plan is at', () => {
    expect(html).toContain('Step 3 of 5: Pick')
  })
})
```
Run: `npx vitest run src/client/screens/StyleScreen.test.tsx src/client/screens/DoneScreen.test.tsx src/client/screens/LostPhotosScreen.test.tsx`
Expected: FAIL — the screens and hooks do not exist.

- [ ] **Step 2: Calmer `PhotoStrip` and `BackgroundPicker`**

Replace `src/client/components/PhotoStrip.tsx` with:
```tsx
/** The finished strip, framed like a print. */
export function PhotoStrip({ url, error }: { url: string | null; error: boolean }) {
  if (error) {
    return (
      <p role="alert" className="border-4 border-ink bg-orange p-4 text-lg font-bold">
        Couldn't build the strip. Try a different frame.
      </p>
    )
  }
  if (!url) return <p className="border-4 border-ink bg-yellow p-4 text-lg font-bold">Developing…</p>
  return (
    <div className="mx-auto w-fit max-w-full border-4 border-ink bg-white p-2 shadow-brutal">
      <img src={url} alt="Photo strip" className="block max-h-[60dvh] max-w-full" />
    </div>
  )
}
```
In `src/client/components/BackgroundPicker.tsx`: change the legend class to `mb-2 text-sm font-black` and the "none" swatch text from `SIDE BY SIDE` to `Side by side` with class `grid h-12 w-16 place-items-center text-center text-[10px] font-bold leading-tight text-ink` (no `uppercase`).

- [ ] **Step 3: The lifted style state and the finished-strip hook**

Create `src/client/hooks/useStyleState.ts`:
```ts
import { useState } from 'react'
import type { BackgroundId } from '../lib/backgrounds'
import type { FilterId } from '../lib/filters'

/** This person's look (never shared: spec D29). Lives in the booth page so it survives step changes. */
export function useStyleState() {
  const [background, setBackground] = useState<BackgroundId>('none')
  const [filter, setFilter] = useState<FilterId>('original')
  const [format, setFormat] = useState<'png' | 'jpg'>('png')
  const [attempt, setAttempt] = useState(0) // bumped to retry the cutouts after a failure
  return { background, setBackground, filter, setFilter, format, setFormat, attempt, retryCutouts: () => setAttempt((n) => n + 1) }
}

export type StyleState = ReturnType<typeof useStyleState>
```

Create `src/client/hooks/useFinishedStrip.ts`:
```ts
import { useMemo } from 'react'
import { APP_NAME } from '../../shared/constants'
import { useToast } from '../components/BrutalToast'
import { canvasToBlob } from '../lib/photo'
import { downloadBlob, formatStripDate, shareImage } from '../lib/strip'
import type { Finished } from '../lib/takes'
import { useCutouts, type CutoutStatus } from './useCutouts'
import type { StyleState } from './useStyleState'
import { useStrip } from './useStrip'

export interface FinishedStrip {
  url: string | null
  error: boolean
  /** The strip is composed: Download and Share can work. */
  ready: boolean
  cutout: CutoutStatus
  /** At least one frame has both people (the background picker only makes sense then). */
  hasTogether: boolean
  download: () => void
  share: () => void
}

/**
 * The strip for the Style and Done steps, composed once for both. `finished` is null until the plan is on style or done
 * and this tab holds every photo the frames use; nothing is composed until then.
 */
export function useFinishedStrip(finished: Finished | null, code: string, style: StyleState): FinishedStrip {
  const toast = useToast()
  const { background, filter, format, attempt } = style
  const cells = finished?.cells ?? null
  const template = finished?.template ?? null
  const meta = useMemo(() => ({ code, filter, dateLabel: formatStripDate(new Date()) }), [code, filter])
  const hasTogether = cells?.some((c) => c.kind === 'both') ?? false
  const wantsCutout = background !== 'none' && hasTogether
  const cut = useCutouts(cells, wantsCutout, attempt)
  const scene = wantsCutout && cut.status === 'ready' ? background : null // `wantsCutout` already rules out 'none'
  const { url, canvas, error } = useStrip(cells, template, meta, scene, cut.byKey)
  const filename = `${APP_NAME.toLowerCase()}-${code}-${template ?? 'strip'}.${format}`

  const encode = async (): Promise<Blob | null> => (canvas ? canvasToBlob(canvas, format === 'png' ? 'image/png' : 'image/jpeg', 0.92) : null)

  return {
    url,
    error,
    ready: canvas !== null,
    cutout: cut.status,
    hasTogether,
    download: () =>
      void (async () => {
        const blob = await encode()
        if (blob) downloadBlob(blob, filename)
      })(),
    share: () =>
      void (async () => {
        const blob = await encode()
        if (!blob) return
        if ((await shareImage(blob, filename, 'Made in the booth.')) === 'unsupported') {
          downloadBlob(blob, filename)
          toast('Photo saved.')
        }
      })(),
  }
}
```

- [ ] **Step 4: The three screens**

Create `src/client/screens/StyleScreen.tsx`:
```tsx
import { BackgroundPicker } from '../components/BackgroundPicker'
import { BrutalButton } from '../components/BrutalButton'
import { BrutalCard } from '../components/BrutalCard'
import { FilterPicker } from '../components/FilterPicker'
import { PhotoStrip } from '../components/PhotoStrip'
import { WizardShell, type ShellInfo } from '../components/WizardShell'
import type { FinishedStrip } from '../hooks/useFinishedStrip'
import type { StyleState } from '../hooks/useStyleState'

interface Props {
  shell: ShellInfo
  strip: FinishedStrip
  style: StyleState
}

/** Step 4: this person's own background and filter, with the strip updating live. */
export function StyleScreen({ shell, strip, style }: Props) {
  return (
    <WizardShell
      {...shell}
      step="style"
      wide
      title="Pick a look"
      primary={
        <BrutalButton tone="yellow" size="xl" className="w-full" onClick={() => shell.onGo('done')}>
          Next
        </BrutalButton>
      }
    >
      <PhotoStrip url={strip.url} error={strip.error} />
      <BrutalCard heavy className="flex flex-col gap-5 p-4">
        {strip.hasTogether && (
          <div className="flex flex-col gap-2">
            <BackgroundPicker
              value={style.background}
              onChange={(id) => {
                style.setBackground(id)
                if (strip.cutout === 'failed') style.retryCutouts() // choosing again after a failure is a retry
              }}
            />
            {strip.cutout === 'loading' && (
              <p role="status" className="text-sm font-bold">
                Cutting you out…
              </p>
            )}
            {strip.cutout === 'failed' && (
              <p role="status" className="border-[3px] border-ink bg-orange p-2 text-sm font-bold">
                Couldn't cut you out. Showing side by side.
              </p>
            )}
            <p className="text-sm font-medium">Cutouts are made on your device.</p>
          </div>
        )}
        <FilterPicker value={style.filter} onChange={style.setFilter} />
      </BrutalCard>
    </WizardShell>
  )
}
```

Create `src/client/screens/DoneScreen.tsx`:
```tsx
import { BrutalButton } from '../components/BrutalButton'
import { BrutalCard } from '../components/BrutalCard'
import { BrutalRadioGroup } from '../components/BrutalRadioGroup'
import { PhotoStrip } from '../components/PhotoStrip'
import { WizardShell, type ShellInfo } from '../components/WizardShell'
import type { FinishedStrip } from '../hooks/useFinishedStrip'
import type { StyleState } from '../hooks/useStyleState'

interface Props {
  shell: ShellInfo
  strip: FinishedStrip
  style: StyleState
  partnerHere: boolean
  /** Shown above the strip when the partner moved the plan on while you were looking at it. */
  notice?: { text: string; action: string; onAction: () => void }
  onMakeAnother: () => void
}

/** Step 5: the final strip, Download first. The strip is never taken away from under you (spec §5). */
export function DoneScreen({ shell, strip, style, partnerHere, notice, onMakeAnother }: Props) {
  return (
    <WizardShell
      {...shell}
      step="done"
      title="All done!"
      primary={
        <BrutalButton tone="yellow" size="xl" className="w-full" disabled={!strip.ready} onClick={strip.download}>
          Download
        </BrutalButton>
      }
    >
      {notice && (
        <BrutalCard tone="orange" className="flex flex-col gap-3 p-4" role="status">
          <p className="text-lg font-bold">{notice.text}</p>
          <BrutalButton tone="ink" onClick={notice.onAction}>
            {notice.action}
          </BrutalButton>
        </BrutalCard>
      )}
      {!partnerHere && !notice && (
        <BrutalCard tone="orange" className="p-3 text-lg font-bold" role="status">
          Your partner left. Save your strip before you go.
        </BrutalCard>
      )}
      <PhotoStrip url={strip.url} error={strip.error} />
      <BrutalRadioGroup
        legend="File type"
        name="format"
        value={style.format}
        onChange={style.setFormat}
        options={[
          { value: 'png', label: 'PNG' },
          { value: 'jpg', label: 'JPG' },
        ]}
      />
      <div className="flex flex-wrap gap-3">
        <BrutalButton tone="paper" disabled={!strip.ready} onClick={strip.share}>
          Share
        </BrutalButton>
        <BrutalButton tone="paper" onClick={onMakeAnother}>
          Make another
        </BrutalButton>
      </div>
    </WizardShell>
  )
}
```

Create `src/client/screens/LostPhotosScreen.tsx`:
```tsx
import type { Step } from '../../shared/plan'
import { BrutalButton } from '../components/BrutalButton'
import { WizardShell, type ShellInfo } from '../components/WizardShell'

interface Props {
  shell: ShellInfo
  /** The step the plan is at; the stepper keeps showing it. */
  step: Step
  onStartOver: () => void
}

/** The plan points at photos this tab does not hold (it was reloaded). Say so, and offer a fresh start. */
export function LostPhotosScreen({ shell, step, onStartOver }: Props) {
  return (
    <WizardShell
      {...shell}
      step={step}
      backless
      title="Your photos were lost when this page reloaded"
      lead="They live only in the tab they were taken in. Start over to make a new strip."
      primary={
        <BrutalButton tone="ink" size="xl" className="w-full" onClick={onStartOver}>
          Start over
        </BrutalButton>
      }
    />
  )
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/client`
Expected: PASS (all screen tests, the shell tests, the lib tests and the style rules).

- [ ] **Step 6: Phase 2 gate**

Run: `npm test && npm run lint`
Run: the filtered `tsc` command from the phase header.
Expected: tests and lint exit 0; the filtered `tsc` prints `no errors in this phase's files`.

- [ ] **Step 7: Commit**

```bash
git add src/client/hooks/useStyleState.ts src/client/hooks/useFinishedStrip.ts \
  src/client/screens/StyleScreen.tsx src/client/screens/StyleScreen.test.tsx \
  src/client/screens/DoneScreen.tsx src/client/screens/DoneScreen.test.tsx \
  src/client/screens/LostPhotosScreen.tsx src/client/screens/LostPhotosScreen.test.tsx \
  src/client/components/PhotoStrip.tsx src/client/components/BackgroundPicker.tsx
git commit -m "feat: add the style, done and lost-photos screens"
```
