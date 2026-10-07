import { Link } from 'react-router'
import { APP_NAME } from '../../shared/constants'

export function Home() {
  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="text-5xl font-black">{APP_NAME}</h1>
      <p className="mt-2 font-bold">A TWO-PERSON PHOTO BOOTH FOR PEOPLE WHO AREN'T IN THE SAME PLACE.</p>
      <nav className="mt-6 flex flex-wrap gap-3">
        <Link to="/create" className="border-4 border-black px-4 py-3 font-black">
          CREATE A BOOTH →
        </Link>
        <Link to="/join" className="border-4 border-black px-4 py-3 font-black">
          JOIN A BOOTH
        </Link>
      </nav>
    </main>
  )
}
