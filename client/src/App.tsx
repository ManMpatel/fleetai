import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Sidebar from './components/Sidebar'
import FleetPage from './pages/FleetPage'
import NotificationsPage from './pages/NotificationsPage'
import ChatPage from './pages/ChatPage'
import RentersPage from './pages/RentersPage'
import OnboardPage from './pages/OnboardPage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public onboarding form — no sidebar */}
        <Route path="/onboard/:phone" element={<OnboardPage />} />

        {/* Main app with sidebar */}
        <Route path="/*" element={
          <div className="flex min-h-screen bg-bg">
            <Sidebar />
            <main className="flex-1 flex flex-col min-w-0">
              <Routes>
                <Route path="/" element={<FleetPage />} />
                <Route path="/renters" element={<RentersPage />} />
                <Route path="/notifications" element={<NotificationsPage />} />
                <Route path="/chat" element={<ChatPage />} />
              </Routes>
            </main>
          </div>
        } />
      </Routes>
    </BrowserRouter>
  )
}