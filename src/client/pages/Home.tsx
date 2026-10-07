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
