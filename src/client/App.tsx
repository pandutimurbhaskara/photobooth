import { BrowserRouter, Route, Routes } from 'react-router'
import { Booth } from './pages/Booth'
import { CreateBooth } from './pages/CreateBooth'
import { Home } from './pages/Home'
import { JoinBooth } from './pages/JoinBooth'

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/create" element={<CreateBooth />} />
        <Route path="/join" element={<JoinBooth />} />
        <Route path="/b/:code" element={<Booth />} />
        <Route path="*" element={<Home />} />
      </Routes>
    </BrowserRouter>
  )
}
