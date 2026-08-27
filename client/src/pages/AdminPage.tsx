import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import axios from 'axios'
import { useStore } from '../store/useStore'
import OrgCredentialsModal, { type CredentialOwner, type OrgCredentials } from './admin/OrgCredentialsModal'
import CreateUserModal from './admin/CreateUserModal'

interface Auth0User {
  user_id: string
  name: string
  email: string
  picture: string
  last_login: string
  logins_count: number
  blocked: boolean
}

interface Owner extends CredentialOwner {
  _id: string
  email: string
  name: string
  picture?: string
  status: 'pending' | 'approved' | 'rejected'
  createdAt: string
  displayName?: string
  slug?: string | null
  hasAuth0Id?: boolean
  credentials?: OrgCredentials
}

interface LogEntry {
  _id: string
  type: string
  date: string
  user_name: string
  ip: string
  user_agent: string
}

interface Stats {
  totalOwners: number
  approvedOwners: number
  totalRenters: number
  activeRenters: number
  pendingRenters: number
  totalVehicles: number
  rentedVehicles: number
  totalServices: number
  breakdown: Array<{
    email: string
    name: string
    status: string
    picture?: string
    renters: number
    vehicles: number
    services: number
    createdAt: string
  }>
}

/** At-a-glance view of what a client still has to have configured before they can trade. */
function SetupBadges({ owner }: { owner: Owner }) {
  const c = owner.credentials
  const items: Array<[string, boolean]> = [
    ['PayWay', !!c?.payway.configured],
    ['WhatsApp', !!c?.whatsapp.configured],
    ['Email', !!c?.gmail.configured],
    ['SMS', !!c?.sms.configured],
    ['Link', !!owner.slug],
  ]
  return (
    <div className="flex gap-1 flex-wrap">
      {items.map(([name, ok]) => (
        <span key={name}
              title={ok ? `${name} configured` : `${name} not configured`}
              className={`text-[10px] px-1.5 py-0.5 rounded ${
                ok ? 'bg-green-bg text-green' : 'bg-surface2 text-text-muted'
              }`}>
          {name}
        </span>
      ))}
    </div>
  )
}

export default function AdminPage() {
  // Whether this user is the platform operator is decided by the server from the
  // verified token, not by comparing against an email baked into the bundle.
  const session = useStore(s => s.session)
  const isSuperAdmin = !!session?.isSuperAdmin
  const [users, setUsers]   = useState<Auth0User[]>([])
  const [logs, setLogs]     = useState<LogEntry[]>([])
  const [health, setHealth] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [blocking, setBlocking] = useState<string | null>(null)
  const [owners, setOwners] = useState<Owner[]>([])
  const [stats, setStats]   = useState<Stats | null>(null)
  const [activeTab, setActiveTab] = useState<'overview' | 'owners' | 'users' | 'logs'>('overview')
  // Opened from an owner row, and automatically right after Approve or after a client is
  // created — a new client cannot take a payment or send a message until these are filled in.
  const [credentialsFor, setCredentialsFor] = useState<Owner | null>(null)
  const [creatingUser, setCreatingUser] = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)

  if (!isSuperAdmin) {
    return (
      <div className="flex-1 flex items-center justify-center h-screen">
        <div className="text-center">
          <p className="text-4xl mb-3">🔒</p>
          <p className="text-text-primary font-semibold">Access Denied</p>
          <p className="text-text-muted text-sm mt-1">This area is restricted to the platform administrator.</p>
        </div>
      </div>
    )
  }

  async function fetchData() {
    try {
      const [ownersRes, healthRes, statsRes] = await Promise.all([
        axios.get('/api/admin/owners'),
        axios.get('/api/health'),
        axios.get('/api/admin/stats'),
      ])
      setOwners(ownersRes.data || [])
      setHealth(healthRes.data)
      setStats(statsRes.data)
    } catch (e) { console.error(e) }

    try {
      const usersRes = await axios.get('/api/admin/users')
      setUsers(usersRes.data.users || [])
    } catch (e) { console.error('Auth0 users error', e) }

    try {
      const logsRes = await axios.get('/api/admin/logs')
      setLogs(logsRes.data || [])
    } catch (e) { console.error('Auth0 logs error', e) }

    setLoading(false)
  }

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 60000)
    return () => clearInterval(interval)
  }, [])

  async function toggleBlock(userId: string, currentlyBlocked: boolean) {
    setBlocking(userId)
    try {
      await axios.patch(`/api/admin/users/${encodeURIComponent(userId)}`,
        { blocked: !currentlyBlocked })
      setUsers(prev => prev.map(u =>
        u.user_id === userId ? { ...u, blocked: !currentlyBlocked } : u
      ))
    } finally { setBlocking(null) }
  }

  /**
   * Deletes the Auth0 login and revokes the organisation. Their fleet data is kept — the
   * server never drops the organisation record, so this is recoverable.
   */
  async function removeUser(userId: string, email: string) {
    const ok = window.confirm(
      `Remove ${email}?\n\n` +
      `Their login is deleted and their access revoked. Renters, vehicles and service ` +
      `history are kept, and access can be restored by creating a new login for this address.`
    )
    if (!ok) return

    setRemoving(userId)
    try {
      await axios.delete(`/api/admin/users/${encodeURIComponent(userId)}`)
      setUsers(prev => prev.filter(u => u.user_id !== userId))
      fetchData()
    } catch (err: any) {
      window.alert(err.response?.data?.error || 'Could not remove that user')
    } finally {
      setRemoving(null)
    }
  }

  const activeToday = users.filter(u =>
    new Date(u.last_login) > new Date(Date.now() - 86400000)
  ).length
  const blockedCount = users.filter(u => u.blocked).length
  const pendingOwners = owners.filter(o => o.status === 'pending').length

  // Platform-level wiring only. WhatsApp, PayWay and email are per client now, so their
  // per-client state lives in the Setup column of the Owners tab, not here.
  const services = [
    { name: 'Railway server', ok: !!health },
    { name: 'MongoDB',        ok: !!health },
    { name: 'Gemini AI',      ok: !!health?.services?.gemini },
    { name: 'Gmail OAuth app', ok: !!health?.services?.gmail },
  ]

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-bg">

      {/* Header */}
      <div className="px-6 py-4 border-b border-border bg-surface flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-xl font-bold text-text-primary">Super Admin</h1>
          <p className="text-text-muted text-sm mt-0.5">Platform administration</p>
        </div>
        <div className="flex items-center gap-3">
          {/* This route renders without the sidebar, so it carries its own way out. */}
          <Link to="/" className="text-xs text-text-muted hover:text-text-primary px-3 py-1.5 rounded-full border border-border">
            ← Dashboard
          </Link>
          {pendingOwners > 0 && (
            <span className="text-xs bg-amber-bg text-amber px-3 py-1.5 rounded-full border border-amber/20 font-medium">
              {pendingOwners} owner{pendingOwners > 1 ? 's' : ''} pending
            </span>
          )}
          <span className="flex items-center gap-1.5 text-xs text-green px-3 py-1.5 rounded-full bg-green-bg">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span>
            {health ? 'All systems operational' : 'Checking...'}
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border bg-surface shrink-0 px-6">
        {(['overview', 'owners', 'users', 'logs'] as const).map(t => (
          <button key={t} onClick={() => setActiveTab(t)}
            className={`py-3 px-4 text-sm font-medium border-b-2 transition-colors capitalize ${
              activeTab === t ? 'border-accent text-accent' : 'border-transparent text-text-muted hover:text-text-primary'
            }`}>
            {t}
            {t === 'owners' && pendingOwners > 0 && (
              <span className="ml-1.5 text-[10px] bg-amber-bg text-amber px-1.5 py-0.5 rounded-full">{pendingOwners}</span>
            )}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-4">

        {/* ── OVERVIEW TAB ── */}
        {activeTab === 'overview' && (
          <>
            {/* System health */}
            <div className="bg-surface border border-border rounded-xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-border">
                <h2 className="text-sm font-semibold text-text-primary">System health</h2>
              </div>
              <div className="grid grid-cols-4 divide-x divide-border">
                {services.map(s => (
                  <div key={s.name} className="px-5 py-4">
                    <p className="text-xs text-text-muted mb-1">{s.name}</p>
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${s.ok ? 'bg-green-500' : 'bg-red-500'}`} />
                      <span className="text-sm font-medium text-text-primary">{s.ok ? 'Online' : 'Error'}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Platform stats */}
            {stats && (
              <>
                <div className="grid grid-cols-4 gap-3">
                  {[
                    { label: 'Total owners', value: stats.totalOwners, sub: `${stats.approvedOwners} approved` },
                    { label: 'Total renters', value: stats.totalRenters, sub: `${stats.activeRenters} active · ${stats.pendingRenters} pending` },
                    { label: 'Total vehicles', value: stats.totalVehicles, sub: `${stats.rentedVehicles} currently rented` },
                    { label: 'Service records', value: stats.totalServices, sub: 'all time' },
                  ].map(m => (
                    <div key={m.label} className="bg-surface border border-border rounded-xl p-5">
                      <p className="text-xs text-text-muted mb-1">{m.label}</p>
                      <p className="text-3xl font-bold text-text-primary">{m.value}</p>
                      <p className="text-xs text-text-muted mt-1">{m.sub}</p>
                    </div>
                  ))}
                </div>

                {/* Auth0 stats row */}
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { label: 'Auth0 users', value: loading ? '...' : users.length, sub: 'registered accounts' },
                    { label: 'Active today', value: loading ? '...' : activeToday, sub: 'logged in last 24h' },
                    { label: 'Blocked users', value: loading ? '...' : blockedCount, sub: blockedCount > 0 ? 'review needed' : 'all clear' },
                  ].map(m => (
                    <div key={m.label} className="bg-surface border border-border rounded-xl p-5">
                      <p className="text-xs text-text-muted mb-1">{m.label}</p>
                      <p className="text-3xl font-bold text-text-primary">{m.value}</p>
                      <p className="text-xs text-text-muted mt-1">{m.sub}</p>
                    </div>
                  ))}
                </div>

                {/* Per-owner breakdown */}
                <div className="bg-surface border border-border rounded-xl overflow-hidden">
                  <div className="px-5 py-3.5 border-b border-border">
                    <h2 className="text-sm font-semibold text-text-primary">Per-owner breakdown</h2>
                  </div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-surface2">
                        {['Owner', 'Status', 'Renters', 'Vehicles', 'Services', 'Joined'].map(h => (
                          <th key={h} className="px-4 py-2.5 text-left text-xs text-text-muted font-medium">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {stats.breakdown.map(o => (
                        <tr key={o.email} className="border-b border-border last:border-0 hover:bg-surface2">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              {o.picture
                                ? <img src={o.picture} className="w-6 h-6 rounded-full" />
                                : <div className="w-6 h-6 rounded-full bg-accent/10 flex items-center justify-center text-[10px] font-bold text-accent">{o.name?.charAt(0)}</div>
                              }
                              <div>
                                <p className="text-xs font-medium text-text-primary">{o.name}</p>
                                <p className="text-[11px] text-text-muted">{o.email}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                              o.status === 'approved' ? 'bg-green-bg text-green' :
                              o.status === 'rejected' ? 'bg-red-bg text-red' : 'bg-amber-bg text-amber'
                            }`}>{o.status}</span>
                          </td>
                          <td className="px-4 py-3 text-text-primary font-medium">{o.renters}</td>
                          <td className="px-4 py-3 text-text-primary font-medium">{o.vehicles}</td>
                          <td className="px-4 py-3 text-text-primary font-medium">{o.services}</td>
                          <td className="px-4 py-3 text-text-muted text-xs">
                            {new Date(o.createdAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </>
        )}

        {/* ── OWNERS TAB ── */}
        {activeTab === 'owners' && (
          <div className="bg-surface border border-border rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
              <h2 className="text-sm font-semibold text-text-primary">Owner access requests</h2>
              <span className="text-xs text-text-muted">{owners.length} total</span>
            </div>
            {owners.length === 0 ? (
              <div className="p-8 text-center text-text-muted text-sm">No owners yet</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface2">
                    {['Owner', 'Email', 'Requested', 'Status', 'Setup', 'Actions'].map(h => (
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
                          <span className="font-medium text-text-primary text-sm">{o.name || 'Unknown'}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-text-muted text-xs">{o.email}</td>
                      <td className="px-4 py-3 text-text-muted text-xs">
                        {new Date(o.createdAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                          o.status === 'approved' ? 'bg-green-bg text-green' :
                          o.status === 'rejected' ? 'bg-red-bg text-red' : 'bg-amber-bg text-amber'
                        }`}>{o.status}</span>
                      </td>
                      <td className="px-4 py-3">
                        <SetupBadges owner={o} />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-2 flex-wrap">
                          {o.status !== 'approved' && (
                            <button onClick={async () => {
                              const { data } = await axios.patch<Owner>(`/api/admin/owners/${encodeURIComponent(o.email)}/approve`, {})
                              const approved = { ...o, ...data, status: 'approved' as const }
                              setOwners(prev => prev.map(x => x._id === o._id ? approved : x))
                              // Approval alone leaves them unable to charge or message —
                              // go straight to their credentials.
                              setCredentialsFor(approved)
                            }} className="text-xs px-3 py-1.5 rounded-lg border border-green/30 text-green hover:bg-green-bg">
                              Approve
                            </button>
                          )}
                          {o.status !== 'rejected' && o.email !== session?.email && (
                            <button onClick={async () => {
                              await axios.patch(`/api/admin/owners/${encodeURIComponent(o.email)}/reject`, {})
                              setOwners(prev => prev.map(x => x._id === o._id ? { ...x, status: 'rejected' } : x))
                            }} className="text-xs px-3 py-1.5 rounded-lg border border-red/30 text-red hover:bg-red-bg">
                              Reject
                            </button>
                          )}
                          {o.status === 'approved' && o.email !== session?.email && (
                            <button onClick={async () => {
                              await axios.patch(`/api/admin/owners/${encodeURIComponent(o.email)}/revoke`, {})
                              setOwners(prev => prev.map(x => x._id === o._id ? { ...x, status: 'pending' } : x))
                            }} className="text-xs px-3 py-1.5 rounded-lg border border-amber/30 text-amber hover:bg-amber-bg">
                              Revoke
                            </button>
                          )}
                          <button onClick={() => setCredentialsFor(o)}
                                  className="text-xs px-3 py-1.5 rounded-lg border border-border text-text-secondary hover:bg-surface2">
                            Credentials
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* ── USERS TAB ── */}
        {activeTab === 'users' && (
          <div className="bg-surface border border-border rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
              <h2 className="text-sm font-semibold text-text-primary">Auth0 users</h2>
              <div className="flex items-center gap-3">
                <span className="text-xs text-text-muted">{users.length} total · {blockedCount} blocked</span>
                <button
                  onClick={() => setCreatingUser(true)}
                  className="text-xs px-3 py-1.5 rounded-lg bg-accent text-white font-medium"
                >
                  + Add user
                </button>
              </div>
            </div>
            {loading ? (
              <div className="p-8 text-center text-text-muted text-sm">Loading...</div>
            ) : users.length === 0 ? (
              <div className="p-8 text-center text-text-muted text-sm">No users found — check Auth0 Management API permissions</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface2">
                    {['User', 'Email', 'Last login', 'Total logins', 'Status', 'Actions'].map(h => (
                      <th key={h} className="px-4 py-2.5 text-left text-xs text-text-muted font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {users.map(u => (
                    <tr key={u.user_id} className="border-b border-border last:border-0 hover:bg-surface2">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {u.picture && <img src={u.picture} className="w-7 h-7 rounded-full" />}
                          <span className="font-medium text-text-primary text-sm">{u.name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-text-muted text-xs">{u.email}</td>
                      <td className="px-4 py-3 text-text-muted text-xs">
                        {u.last_login ? new Date(u.last_login).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}
                      </td>
                      <td className="px-4 py-3 text-text-primary text-sm">{u.logins_count}</td>
                      <td className="px-4 py-3">
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${u.blocked ? 'bg-red-bg text-red' : 'bg-green-bg text-green'}`}>
                          {u.blocked ? 'Blocked' : 'Active'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {u.email !== session?.email && (
                          <div className="flex gap-2">
                            <button
                              onClick={() => toggleBlock(u.user_id, u.blocked)}
                              disabled={blocking === u.user_id}
                              className={`text-xs px-3 py-1.5 rounded-lg border disabled:opacity-40 ${
                                u.blocked
                                  ? 'border-green/30 text-green hover:bg-green-bg'
                                  : 'border-red/30 text-red hover:bg-red-bg'
                              }`}
                            >
                              {blocking === u.user_id ? '...' : u.blocked ? 'Unblock' : 'Block'}
                            </button>
                            <button
                              onClick={() => removeUser(u.user_id, u.email)}
                              disabled={removing === u.user_id}
                              className="text-xs px-3 py-1.5 rounded-lg border border-red/30 text-red hover:bg-red-bg disabled:opacity-40"
                            >
                              {removing === u.user_id ? '...' : 'Remove'}
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* ── LOGS TAB ── */}
        {activeTab === 'logs' && (
          <div className="bg-surface border border-border rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
              <h2 className="text-sm font-semibold text-text-primary">Recent login activity</h2>
              <span className="text-xs text-text-muted">last 20 events</span>
            </div>
            {loading ? (
              <div className="p-8 text-center text-text-muted text-sm">Loading...</div>
            ) : logs.length === 0 ? (
              <div className="p-8 text-center text-text-muted text-sm">No logs found — check Auth0 Management API permissions</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface2">
                    {['Time', 'User', 'Event', 'IP', 'Result'].map(h => (
                      <th key={h} className="px-4 py-2.5 text-left text-xs text-text-muted font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log, i) => (
                    <tr key={i} className="border-b border-border last:border-0 hover:bg-surface2">
                      <td className="px-4 py-2.5 text-text-muted text-xs">
                        {new Date(log.date).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="px-4 py-2.5 text-text-primary text-xs">{log.user_name || 'Unknown'}</td>
                      <td className="px-4 py-2.5 text-text-secondary text-xs">
                        {log.type === 's' ? 'Login success' : log.type === 'f' ? 'Login failed' : log.type}
                      </td>
                      <td className="px-4 py-2.5 text-text-muted text-xs font-mono">{log.ip}</td>
                      <td className="px-4 py-2.5">
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                          log.type === 's' ? 'bg-green-bg text-green' : 'bg-red-bg text-red'
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
        )}

      </div>

      {creatingUser && (
        <CreateUserModal
          onClose={() => setCreatingUser(false)}
          onCreated={owner => {
            // Straight into the credentials form: the client exists but can do nothing
            // until their PayWay and messaging keys are entered.
            setCreatingUser(false)
            setCredentialsFor(owner as Owner)
            fetchData()
          }}
        />
      )}

      {credentialsFor && (
        <OrgCredentialsModal
          owner={credentialsFor}
          onClose={() => setCredentialsFor(null)}
          onSaved={updated => {
            setOwners(prev => prev.map(x =>
              x._id === updated._id ? { ...x, ...updated } as Owner : x
            ))
            setCredentialsFor(prev => prev ? { ...prev, ...updated } as Owner : prev)
          }}
        />
      )}
    </div>
  )
}