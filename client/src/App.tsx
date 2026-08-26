import { BrowserRouter, Routes, Route } from 'react-router-dom'
import axios from 'axios'
import { useState, useEffect, useRef } from 'react'
import Sidebar from './components/Sidebar'
import FleetPage from './pages/FleetPage'
import NotificationsPage from './pages/NotificationsPage'
import ChatPage from './pages/ChatPage'
import RentersPage from './pages/renters/RentersPage'
import OnboardPage from './pages/OnboardPage'
import AdminPage from './pages/AdminPage'
import SearchPage from './pages/SearchPage'
import RegoImportPage from './pages/RegoImportPage'
import SettingsPage from './pages/SettingsPage'
import { useAuth0 } from '@auth0/auth0-react'
import TabletPage from './pages/TabletPage'
import StaffPage from './pages/StaffPage'
import InvoicePage from './pages/InvoicePage'
import ServiceHistoryPage from './pages/ServiceHistoryPage'
import { useStore } from './store/useStore'

function LoginPage() {
  const { loginWithRedirect } = useAuth0()
  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', display: 'flex', fontFamily: 'DM Sans, system-ui, sans-serif' }}>
      {/* Left panel */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '48px 64px', background: 'linear-gradient(135deg, #1e3a5f 0%, #1e40af 60%, #3b82f6 100%)', position: 'relative', overflow: 'hidden' }}>
        {/* Background decoration */}
        <div style={{ position: 'absolute', top: -80, right: -80, width: 300, height: 300, borderRadius: '50%', background: 'rgba(255,255,255,0.05)' }} />
        <div style={{ position: 'absolute', bottom: -40, left: -40, width: 200, height: 200, borderRadius: '50%', background: 'rgba(255,255,255,0.04)' }} />

        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, position: 'relative' }}>
          <div style={{ width: 38, height: 38, background: 'rgba(255,255,255,0.15)', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(10px)' }}>
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M4 14L10 4L16 14H4Z" fill="white" opacity="0.95"/><rect x="7" y="14" width="6" height="3" rx="1" fill="white" opacity="0.6"/></svg>
          </div>
          <span style={{ fontSize: 20, fontWeight: 700, color: '#fff', letterSpacing: '-0.3px' }}>FleetAI</span>
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
          {[['Live', 'Fleet tracking'], ['24/7', 'Monitoring'], ['Auto', 'PayWay billing']].map(([num, label]) => (
            <div key={label}>
              <div style={{ fontSize: 24, fontWeight: 600, color: '#f9fafb' }}>{num}</div>
              <div style={{ fontSize: 12, color: '#4b5563', marginTop: 2 }}>{label}</div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', position: 'relative' }}>© 2026 FleetAI. All rights reserved.</p>
      </div>

      {/* Right panel */}
      <div style={{ width: 460, background: '#fff', display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '60px 52px', boxShadow: '-4px 0 24px rgba(0,0,0,0.06)' }}>
        <div style={{ marginBottom: 40 }}>
          <h2 style={{ fontSize: 26, fontWeight: 700, color: '#0f172a', marginBottom: 8, letterSpacing: '-0.5px' }}>Welcome back</h2>
          <p style={{ fontSize: 14, color: '#64748b', lineHeight: 1.6 }}>Sign in to your FleetAI dashboard to manage your fleet.</p>
        </div>

        <button
          onClick={() => loginWithRedirect()}
          style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, background: '#fff', color: '#1e293b', border: '1.5px solid #e2e8f0', borderRadius: 12, padding: '14px 20px', fontSize: 15, fontWeight: 500, cursor: 'pointer', marginBottom: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.06)', transition: 'all 0.15s' }}
          onMouseEnter={e => (e.currentTarget.style.borderColor = '#3b82f6', e.currentTarget.style.boxShadow = '0 0 0 3px rgba(59,130,246,0.1)')}
          onMouseLeave={e => (e.currentTarget.style.borderColor = '#e2e8f0', e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.06)')}
        >
          <svg width="18" height="18" viewBox="0 0 18 18"><path fill="#4285F4" d="M16.51 8H8.98v3h4.3c-.18 1-.74 1.48-1.6 2.04v2.01h2.6a7.8 7.8 0 0 0 2.38-5.88c0-.57-.05-.66-.15-1.18z"/><path fill="#34A853" d="M8.98 17c2.16 0 3.97-.72 5.3-1.94l-2.6-2a4.8 4.8 0 0 1-7.18-2.54H1.83v2.07A8 8 0 0 0 8.98 17z"/><path fill="#FBBC05" d="M4.5 10.52a4.8 4.8 0 0 1 0-3.04V5.41H1.83a8 8 0 0 0 0 7.18l2.67-2.07z"/><path fill="#EA4335" d="M8.98 4.18c1.17 0 2.23.4 3.06 1.2l2.3-2.3A8 8 0 0 0 1.83 5.4L4.5 7.49a4.77 4.77 0 0 1 4.48-3.31z"/></svg>
          Continue with Google
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
          <div style={{ flex: 1, height: 1, background: '#f1f5f9' }} />
          <span style={{ fontSize: 12, color: '#94a3b8' }}>Authorised access only</span>
          <div style={{ flex: 1, height: 1, background: '#f1f5f9' }} />
        </div>

        <div style={{ background: '#f8fafc', borderRadius: 12, padding: '16px 18px', border: '1px solid #f1f5f9' }}>
          <p style={{ fontSize: 12, color: '#64748b', lineHeight: 1.7, margin: 0 }}>
            🔒 Access is restricted to approved business owners. New accounts require admin approval before accessing the dashboard.
          </p>
        </div>

        <p style={{ fontSize: 11, color: '#94a3b8', textAlign: 'center', marginTop: 32, lineHeight: 1.6 }}>
          By signing in, you agree to our Terms of Service and Privacy Policy.
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

function Splash({ text }: { text: string }) {
  return (
    <div style={{ minHeight: '100vh', background: '#0d1117', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ color: '#3b82f6', fontSize: 14 }}>{text}</div>
    </div>
  )
}

export default function App() {
  const { isLoading, isAuthenticated, user, logout, getAccessTokenSilently } = useAuth0()
  const [ownerStatus, setOwnerStatus] = useState<'checking' | 'pending' | 'approved' | 'rejected'>('checking')
  const [interceptorReady, setInterceptorReady] = useState(false)
  const setSession = useStore(s => s.setSession)

  const handleLogout = () => logout({ logoutParams: { returnTo: window.location.origin } })

  const isPublicPath = window.location.pathname.startsWith('/onboard') ||
                       window.location.pathname.startsWith('/tablet')

  // The verified Auth0 token is the only thing that identifies the tenant. There is no
  // longer an x-owner-email header — the server derives the organisation from this token.
  useEffect(() => {
    if (!isAuthenticated) return
    const interceptor = axios.interceptors.request.use(async (config) => {
      try {
        const token = await getAccessTokenSilently()
        config.headers.Authorization = `Bearer ${token}`
      } catch {
        // Fall through unauthenticated; the server will reject it.
      }
      return config
    })
    setInterceptorReady(true)
    return () => {
      axios.interceptors.request.eject(interceptor)
      setInterceptorReady(false)
    }
  }, [isAuthenticated, getAccessTokenSilently])

  // Register/refresh this login and pick up the tenant's branding in one call. Runs only
  // once the interceptor is installed, so the request actually carries the token.
  useEffect(() => {
    if (!isAuthenticated || !interceptorReady || !user?.email) return

    let cancelled = false
    const register = async () => {
      try {
        const { data } = await axios.post('/api/auth/register', {
          email: user.email,
          name: user.name,
          picture: user.picture,
        })
        if (cancelled) return
        setOwnerStatus(data.status)
        setSession({ email: data.email ?? null, isSuperAdmin: !!data.isSuperAdmin, org: data.org ?? null })
        return data.status
      } catch {
        if (!cancelled) setOwnerStatus('pending')
      }
    }

    register()
    // While pending, poll so the dashboard unlocks as soon as an admin approves.
    const interval = setInterval(async () => {
      const status = await register()
      if (status === 'approved') clearInterval(interval)
    }, 30000)

    return () => { cancelled = true; clearInterval(interval) }
  }, [isAuthenticated, interceptorReady, user?.email, setSession])

  if (isPublicPath) {
    return (
      <BrowserRouter>
        <Routes>
          <Route path="/onboard/:slug" element={<OnboardPage />} />
          <Route path="/onboard" element={<OnboardPage />} />
          <Route path="/tablet" element={<TabletPage />} />
        </Routes>
      </BrowserRouter>
    )
  }

  if (isLoading) return <Splash text="Loading..." />
  if (!isAuthenticated) return <LoginPage />
  if (ownerStatus === 'checking') return <Splash text="Checking access..." />
  if (ownerStatus === 'pending') return <PendingPage email={user?.email || ''} onLogout={handleLogout} />
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
                <Route path="/"               element={<FleetPage />} />
                <Route path="/renters"        element={<RentersPage />} />
                <Route path="/notifications"  element={<NotificationsPage />} />
                <Route path="/chat"           element={<ChatPage />} />
                <Route path="/search"         element={<SearchPage />} />
                <Route path="/staff"          element={<StaffPage />} />
                <Route path="/settings"       element={<SettingsPage />} />
                <Route path="/invoices"       element={<InvoicePage />} />
                <Route path="/service-history" element={<ServiceHistoryPage />} />
                <Route path="/rego-import"    element={<RegoImportPage />} />
              </Routes>
            </main>
          </div>
        } />
      </Routes>
    </BrowserRouter>
  )
}
