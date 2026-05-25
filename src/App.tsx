import { Routes, Route } from 'react-router-dom'
import Sender from './pages/Sender'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Sender />} />
    </Routes>
  )
}
