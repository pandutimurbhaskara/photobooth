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
