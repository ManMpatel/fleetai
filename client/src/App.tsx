import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { useEffect, useState } from 'react'
import axios from 'axios'
import Sidebar from './components/Sidebar'
import FleetPage from './pages/FleetPage'
import NotificationsPage from './pages/NotificationsPage'
import ChatPage from './pages/ChatPage'
import RentersPage from './pages/RentersPage'
import OnboardPage from './pages/OnboardPage'
import AdminPage from './pages/AdminPage'
import SearchPage from './pages/SearchPage'
import RegoImportPage from './pages/RegoImportPage'
import { useAuth0 } from '@auth0/auth0-react'

function LoginPage() {
  const { loginWithRedirect } = useAuth0()
  return (
    <div style={{ minHeight: '100vh', background: '#0d1117', display: 'flex', fontFamily: 'DM Sans, sans-serif' }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '60px 64px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 48 }}>
          <div style={{ width: 36, height: 36, background: '#3b82f6', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M4 14L10 4L16 14H4Z" fill="white" opacity="0.9"/><rect x="7" y="14" width="6" height="3" rx="1" fill="white" opacity="0.5"/></svg>
          </div>
          <span style={{ fontSize: 20, fontWeight: 600, color: '#f9fafb', letterSpacing: '-0.3px' }}>FleetAI</span>
        </div>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.25)', borderRadius: 100, padding: '4px 12px', fontSize: 12, color: '#93c5fd', marginBottom: 20, width: 'fit-content' }}>
          <div style={{ width: 6, height: 6, background: '#3b82f6', borderRadius: '50%' }}></div>
          Fleet Management Platform
        </div>
        <h1 style={{ fontSize: 38, fontWeight: 600, color: '#f9fafb', lineHeight: 1.15, letterSpacing: '-1px', marginBottom: 16 }}>
          Manage your fleet<br />with <span style={{ color: '#3b82f6' }}>intelligence</span>
        </h1>
        <p style={{ fontSize: 15, color: '#6b7280', lineHeight: 1.6, maxWidth: 360, marginBottom: 40 }}>
          Real-time tracking, automated payments, and AI-powered insights for your fleet.
        </p>
        <div style={{ display: 'flex', gap: 32 }}>
          {[['100+', 'Vehicles tracked'], ['24/7', 'Monitoring'], ['Auto', 'PayWay billing']].map(([num, label]) => (
            <div key={label}>
              <div style={{ fontSize: 24, fontWeight: 600, color: '#f9fafb' }}>{num}</div>
              <div style={{ fontSize: 12, color: '#4b5563', marginTop: 2 }}>{label}</div>
            </div>
          ))}
        </div>
      </div>
      <div style={{ width: 420, background: '#111827', borderLeft: '1px solid #1f2937', display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '60px 48px' }}>
        <h2 style={{ fontSize: 22, fontWeight: 600, color: '#f9fafb', marginBottom: 6 }}>Welcome</h2>
        <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 32 }}>Sign in to your FleetAI dashboard</p>
        <button
          onClick={() => loginWithRedirect()}
          style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, background: '#f9fafb', color: '#111827', border: 'none', borderRadius: 10, padding: '13px 20px', fontSize: 14, fontWeight: 500, cursor: 'pointer', marginBottom: 16 }}
        >
          <svg width="18" height="18" viewBox="0 0 18 18"><path fill="#4285F4" d="M16.51 8H8.98v3h4.3c-.18 1-.74 1.48-1.6 2.04v2.01h2.6a7.8 7.8 0 0 0 2.38-5.88c0-.57-.05-.66-.15-1.18z"/><path fill="#34A853" d="M8.98 17c2.16 0 3.97-.72 5.3-1.94l-2.6-2a4.8 4.8 0 0 1-7.18-2.54H1.83v2.07A8 8 0 0 0 8.98 17z"/><path fill="#FBBC05" d="M4.5 10.52a4.8 4.8 0 0 1 0-3.04V5.41H1.83a8 8 0 0 0 0 7.18l2.67-2.07z"/><path fill="#EA4335" d="M8.98 4.18c1.17 0 2.23.4 3.06 1.2l2.3-2.3A8 8 0 0 0 1.83 5.4L4.5 7.49a4.77 4.77 0 0 1 4.48-3.31z"/></svg>
          Continue with Google
        </button>
        <p style={{ fontSize: 11, color: '#4b5563', textAlign: 'center', lineHeight: 1.6 }}>
          By signing in, you agree to our Terms of Service
        </p>
      </div>
    </div>
  )
}

function PendingPage({ email, onLogout }: { email: string, onLogout: () => void }) {
  return (
    <div style={{ minHeight: '100vh', background: '#0d1117', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'DM Sans, sans-serif' }}>
      <div style={{ textAlign: 'center', maxWidth: 440, padding: '0 24px' }}>
        <div style={{ width: 64, height: 64, background: 'rgba(234,179,8,0.1)', border: '1px solid rgba(234,179,8,0.3)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px' }}>
          <svg width="28" height="28" fill="none" viewBox="0 0 24 24" stroke="#eab308" strokeWidth="1.5"><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2m6-2a10 10 0 11-20 0 10 10 0 0120 0z"/></svg>
        </div>
        <h2 style={{ fontSize: 22, fontWeight: 600, color: '#f9fafb', marginBottom: 10 }}>Approval Pending</h2>
        <p style={{ fontSize: 14, color: '#6b7280', lineHeight: 1.7, marginBottom: 8 }}>
          Your account <strong style={{ color: '#9ca3af' }}>{email}</strong> has been registered.
        </p>
        <p style={{ fontSize: 14, color: '#6b7280', lineHeight: 1.7, marginBottom: 32 }}>
          The FleetAI administrator will review and approve your access shortly.
        </p>
        <button onClick={onLogout} style={{ padding: '10px 28px', background: 'transparent', color: '#6b7280', border: '1px solid #374151', borderRadius: 8, cursor: 'pointer', fontSize: 14 }}>
          Sign out
        </button>
      </div>
    </div>
  )
}

function RejectedPage({ onLogout }: { onLogout: () => void }) {
  return (
    <div style={{ minHeight: '100vh', background: '#0d1117', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'DM Sans, sans-serif' }}>
      <div style={{ textAlign: 'center', maxWidth: 400, padding: '0 24px' }}>
        <div style={{ width: 64, height: 64, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px' }}>
          <svg width="28" height="28" fill="none" viewBox="0 0 24 24" stroke="#ef4444" strokeWidth="1.5"><path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"/></svg>
        </div>
        <h2 style={{ fontSize: 22, fontWeight: 600, color: '#f9fafb', marginBottom: 10 }}>Access Denied</h2>
        <p style={{ fontSize: 14, color: '#6b7280', lineHeight: 1.7, marginBottom: 32 }}>
          Your access request was not approved. Please contact the FleetAI administrator.
        </p>
        <button onClick={onLogout} style={{ padding: '10px 28px', background: 'transparent', color: '#6b7280', border: '1px solid #374151', borderRadius: 8, cursor: 'pointer', fontSize: 14 }}>
          Sign out
        </button>
      </div>
    </div>
  )
}

export default function App() {
  const { isLoading, isAuthenticated, user, logout, getAccessTokenSilently } = useAuth0()  
  const [ownerStatus, setOwnerStatus] = useState<'checking' | 'pending' | 'approved' | 'rejected'>('checking')
  const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:5000'

  const handleLogout = () => logout({ logoutParams: { returnTo: window.location.origin } })

  useEffect(() => {
    if (!isAuthenticated || !user?.email) return
    // Set axios header for ALL requests
    axios.defaults.headers.common['x-owner-email'] = user.email
    axios.defaults.baseURL = apiUrl
    // Register or check status
    axios.post('/api/auth/register', {
      email:   user.email,
      name:    user.name,
      picture: user.picture,
      auth0Id: user.sub
    }).then(res => {
      setOwnerStatus(res.data.status)
    }).catch(() => {
      setOwnerStatus('pending')
    })
  }, [isAuthenticated, user?.email])

  useEffect(() => {
    if (!isAuthenticated) return
    const interceptor = axios.interceptors.request.use(async (config) => {
      try {
        const token = await getAccessTokenSilently()
        config.headers.Authorization = `Bearer ${token}`
      } catch {}
      return config
    })
    return () => axios.interceptors.request.eject(interceptor)
  }, [isAuthenticated, getAccessTokenSilently])

  if (window.location.pathname.startsWith('/onboard')) {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/onboard/:phone" element={<OnboardPage />} />
        <Route path="/onboard" element={<OnboardPage />} />
      </Routes>
    </BrowserRouter>
  )
}

  if (isLoading) return (
    <div style={{ minHeight: '100vh', background: '#0d1117', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ color: '#3b82f6', fontSize: 14 }}>Loading...</div>
    </div>
  )

  if (!isAuthenticated) return <LoginPage />

  if (ownerStatus === 'checking') return (
    <div style={{ minHeight: '100vh', background: '#0d1117', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ color: '#3b82f6', fontSize: 14 }}>Checking access...</div>
    </div>
  )

  if (ownerStatus === 'pending')  return <PendingPage email={user?.email || ''} onLogout={handleLogout} />
  if (ownerStatus === 'rejected') return <RejectedPage onLogout={handleLogout} />

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/*" element={
          <div className="flex h-screen overflow-hidden bg-bg">
            <div className="h-screen sticky top-0 shrink-0">
              <Sidebar />
            </div>
            <main className="flex-1 flex flex-col min-w-0 overflow-y-auto">
              <Routes>
                <Route path="/"              element={<FleetPage />} />
                <Route path="/renters"       element={<RentersPage />} />
                <Route path="/notifications" element={<NotificationsPage />} />
                <Route path="/chat" element={<ChatPage />} />
                <Route path="/search" element={<SearchPage />} />
                <Route path="/rego-import" element={<RegoImportPage />} />
              </Routes>
            </main>
          </div>
        } />
      </Routes>
    </BrowserRouter>
  )
}