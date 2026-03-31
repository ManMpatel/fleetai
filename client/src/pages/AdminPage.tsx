import { useEffect, useState } from 'react'
import { useAuth0 } from '@auth0/auth0-react'
import axios from 'axios'

const ADMIN_EMAIL = 'manpatel1144@gmail.com'

interface Auth0User {
  user_id: string
  name: string
  email: string
  picture: string
  last_login: string
  logins_count: number
  blocked: boolean
}

interface Owner {
  _id: string
  email: string
  name: string
  picture?: string
  status: 'pending' | 'approved' | 'rejected'
  createdAt: string
}

interface LogEntry {
  _id: string
  type: string
  date: string
  user_name: string
  ip: string
  user_agent: string
  description?: string
}

export default function AdminPage() {
  const { user } = useAuth0()
  const [users, setUsers] = useState<Auth0User[]>([])
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [health, setHealth] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [blocking, setBlocking] = useState<string | null>(null)
  const [owners, setOwners] = useState<Owner[]>([])

  if (user?.email !== ADMIN_EMAIL) {
    return (
      <div className="flex-1 flex items-center justify-center h-screen">
        <div className="text-center">
          <p className="text-4xl mb-3">🔒</p>
          <p className="text-text-primary font-semibold">Access Denied</p>
          <p className="text-text-muted text-sm mt-1">This page is restricted to admins only.</p>
        </div>
      </div>
    )
  }

  const fetchData = async () => {
    try {
        const headers = { 'x-owner-email': user?.email || '' }
        const [usersRes, logsRes, healthRes, ownersRes] = await Promise.all([
        axios.get('/api/admin/users', { headers }),
        axios.get('/api/admin/logs', { headers }),
        axios.get('/api/health'),
        axios.get('/api/admin/owners', { headers }),
        ])
        setUsers(usersRes.data.users || [])
        setLogs(logsRes.data || [])
        setHealth(healthRes.data)
        setOwners(ownersRes.data || [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchData() }, [])

  const toggleBlock = async (userId: string, currentlyBlocked: boolean) => {
    setBlocking(userId)
    try {
      await axios.patch(`/api/admin/users/${encodeURIComponent(userId)}`, {
        blocked: !currentlyBlocked
      })
      setUsers(prev => prev.map(u =>
        u.user_id === userId ? { ...u, blocked: !currentlyBlocked } : u
      ))
    } finally {
      setBlocking(null)
    }
  }

  const services = [
    { name: 'Railway server', ok: !!health },
    { name: 'MongoDB', ok: !!health },
    { name: 'Gemini AI', ok: !!health?.services?.gemini },
    { name: 'Twilio', ok: !!health?.services?.twilio },
  ]

  const activeToday = users.filter(u =>
    new Date(u.last_login) > new Date(Date.now() - 86400000)
  ).length

  const blockedCount = users.filter(u => u.blocked).length

  return (
    <div className="flex-1 p-6 bg-bg overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-text-primary">Super Admin</h1>
          <p className="text-text-muted text-sm mt-0.5">Full system control — restricted to {ADMIN_EMAIL}</p>
        </div>
        <span className="flex items-center gap-1.5 text-xs text-green-600 bg-green-50 dark:bg-green-900/20 px-3 py-1.5 rounded-full">
          <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span>
          All systems operational
        </span>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-5 gap-3 mb-6">
        {[
          { label: 'Total users', value: users.length, sub: 'via Auth0', color: 'text-green-500' },
          { label: 'Active today', value: activeToday, sub: 'last 24h', color: 'text-green-500' },
          { label: 'Blocked users', value: blockedCount, sub: blockedCount > 0 ? 'review needed' : 'all clear', color: blockedCount > 0 ? 'text-yellow-500' : 'text-green-500' },
          { label: 'Server', value: health ? 'Online' : '...', sub: 'Railway', color: 'text-green-500' },
          { label: 'Gemini AI', value: health?.services?.gemini ? 'Active' : '...', sub: 'API configured', color: 'text-green-500' },
        ].map(m => (
          <div key={m.label} className="bg-surface rounded-xl p-4">
            <p className="text-xs text-text-muted mb-1">{m.label}</p>
            <p className="text-2xl font-bold text-text-primary">{m.value}</p>
            <p className={`text-xs mt-1 ${m.color}`}>{m.sub}</p>
          </div>
        ))}
      </div>

      {/* Health */}
      <div className="bg-surface border border-border rounded-xl mb-4 overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h2 className="text-sm font-semibold text-text-primary">System health</h2>
        </div>
        <div className="grid grid-cols-4">
          {services.map((s, i) => (
            <div key={s.name} className={`px-4 py-3 ${i < 3 ? 'border-r border-border' : ''}`}>
              <p className="text-xs text-text-muted mb-1">{s.name}</p>
              <div className="flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${s.ok ? 'bg-green-500' : 'bg-red-500'}`}></span>
                <span className="text-sm font-medium text-text-primary">{s.ok ? 'Online' : 'Error'}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
        
        {/* Owner Requests */}
        <div className="bg-surface border border-border rounded-xl mb-4 overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <h2 className="text-sm font-semibold text-text-primary">Owner access requests</h2>
            <span className="text-xs text-text-muted">
            {owners.filter(o => o.status === 'pending').length} pending
            </span>
        </div>
        {owners.length === 0 ? (
            <div className="p-8 text-center text-text-muted text-sm">No owner requests yet</div>
        ) : (
            <table className="w-full text-sm">
            <thead>
                <tr className="border-b border-border">
                {['Owner', 'Email', 'Requested', 'Status', 'Actions'].map(h => (
                    <th key={h} className="px-4 py-2.5 text-left text-xs text-text-muted font-medium">{h}</th>
                ))}
                </tr>
            </thead>
            <tbody>
                {owners.map(o => (
                <tr key={o._id} className="border-b border-border last:border-0 hover:bg-surface2">
                    <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                        {o.picture && <img src={o.picture} className="w-7 h-7 rounded-full" />}
                        <span className="font-medium text-text-primary">{o.name || 'Unknown'}</span>
                    </div>
                    </td>
                    <td className="px-4 py-3 text-text-muted text-xs">{o.email}</td>
                    <td className="px-4 py-3 text-text-muted text-xs">
                    {new Date(o.createdAt).toLocaleDateString('en-AU', {
                        day: 'numeric', month: 'short', year: 'numeric'
                    })}
                    </td>
                    <td className="px-4 py-3">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                        o.status === 'approved' ? 'bg-green-50 text-green-600 dark:bg-green-900/20 dark:text-green-400' :
                        o.status === 'rejected' ? 'bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400' :
                        'bg-yellow-50 text-yellow-600 dark:bg-yellow-900/20 dark:text-yellow-400'
                    }`}>
                        {o.status}
                    </span>
                    </td>
                    <td className="px-4 py-3 flex gap-2">
                    {o.status !== 'approved' && (
                        <button
                        onClick={async () => {
                            await axios.patch(`/api/admin/owners/${encodeURIComponent(o.email)}/approve`)
                            setOwners(prev => prev.map(x => x._id === o._id ? { ...x, status: 'approved' } : x))
                        }}
                        className="text-xs px-3 py-1.5 rounded-lg border border-green-300 text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20"
                        >
                        Approve
                        </button>
                    )}
                    {o.status !== 'rejected' && o.email !== ADMIN_EMAIL && (
                        <button
                        onClick={async () => {
                            await axios.patch(`/api/admin/owners/${encodeURIComponent(o.email)}/reject`)
                            setOwners(prev => prev.map(x => x._id === o._id ? { ...x, status: 'rejected' } : x))
                        }}
                        className="text-xs px-3 py-1.5 rounded-lg border border-red-300 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                        >
                        Reject
                        </button>
                    )}
                    {o.status === 'approved' && o.email !== ADMIN_EMAIL && (
                        <button
                        onClick={async () => {
                            await axios.patch(`/api/admin/owners/${encodeURIComponent(o.email)}/revoke`)
                            setOwners(prev => prev.map(x => x._id === o._id ? { ...x, status: 'pending' } : x))
                        }}
                        className="text-xs px-3 py-1.5 rounded-lg border border-yellow-300 text-yellow-600 hover:bg-yellow-50 dark:hover:bg-yellow-900/20"
                        >
                        Revoke
                        </button>
                    )}
                    </td>
                </tr>
                ))}
            </tbody>
            </table>
        )}
        </div>
      {/* Users table */}
      <div className="bg-surface border border-border rounded-xl mb-4 overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <h2 className="text-sm font-semibold text-text-primary">Users</h2>
          <span className="text-xs text-text-muted">{users.length} total · {blockedCount} blocked</span>
        </div>
        {loading ? (
          <div className="p-8 text-center text-text-muted text-sm">Loading users...</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                {['User', 'Email', 'Last login', 'Total logins', 'Status', 'Actions'].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left text-xs text-text-muted font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.user_id} className="border-b border-border last:border-0 hover:bg-surface2 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <img src={u.picture} className="w-7 h-7 rounded-full" onError={(e) => (e.currentTarget.style.display = 'none')} />
                      <span className="font-medium text-text-primary">{u.name}</span>
                      {u.email === ADMIN_EMAIL && (
                        <span className="text-[10px] bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300 px-1.5 py-0.5 rounded-full">admin</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-text-muted text-xs">{u.email}</td>
                  <td className="px-4 py-3 text-text-muted text-xs">
                    {new Date(u.last_login).toLocaleDateString('en-AU', {
                      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
                    })}
                  </td>
                  <td className="px-4 py-3 font-medium text-text-primary">{u.logins_count}</td>
                  <td className="px-4 py-3">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                      u.blocked
                        ? 'bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400'
                        : 'bg-green-50 text-green-600 dark:bg-green-900/20 dark:text-green-400'
                    }`}>
                      {u.blocked ? 'Blocked' : 'Active'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {u.email !== ADMIN_EMAIL && (
                      <button
                        onClick={() => toggleBlock(u.user_id, u.blocked)}
                        disabled={blocking === u.user_id}
                        className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                          u.blocked
                            ? 'border-green-300 text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20'
                            : 'border-red-300 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20'
                        } disabled:opacity-40`}
                      >
                        {blocking === u.user_id ? '...' : u.blocked ? 'Unblock' : 'Block'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Activity logs */}
      <div className="bg-surface border border-border rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <h2 className="text-sm font-semibold text-text-primary">Recent login activity</h2>
          <span className="text-xs text-text-muted">last 20 events</span>
        </div>
        {loading ? (
          <div className="p-8 text-center text-text-muted text-sm">Loading logs...</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                {['Time', 'User', 'Event', 'IP', 'Result'].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left text-xs text-text-muted font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {logs.map(log => (
                <tr key={log._id} className="border-b border-border last:border-0 hover:bg-surface2">
                  <td className="px-4 py-2.5 text-text-muted text-xs">
                    {new Date(log.date).toLocaleDateString('en-AU', {
                      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
                    })}
                  </td>
                  <td className="px-4 py-2.5 text-text-primary text-xs">{log.user_name || 'Unknown'}</td>
                  <td className="px-4 py-2.5 text-text-secondary text-xs">
                    {log.type === 's' ? 'Login success' : log.type === 'f' ? 'Login failed' : log.type}
                  </td>
                  <td className="px-4 py-2.5 text-text-muted text-xs font-mono">{log.ip}</td>
                  <td className="px-4 py-2.5">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                      log.type === 's'
                        ? 'bg-green-50 text-green-600 dark:bg-green-900/20 dark:text-green-400'
                        : 'bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400'
                    }`}>
                      {log.type === 's' ? 'success' : 'failed'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

