import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore'
import NotificationCard from '../components/NotificationCard'
import type { NotificationType } from '../types'

const typeFilters: Array<{ value: NotificationType | 'all'; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'fine', label: 'Fines' },
  { value: 'toll', label: 'Tolls' },
  { value: 'rego', label: 'Rego' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'info', label: 'Info' },
]

export default function NotificationsPage() {
  const { notifications, notifLoading, fetchNotifications, markAllRead } = useStore()
  const [typeFilter, setTypeFilter] = useState<NotificationType | 'all'>('all')
  const [showUnreadOnly, setShowUnreadOnly] = useState(false)

  useEffect(() => {
    fetchNotifications()
  }, [fetchNotifications])

  const filtered = notifications.filter((n) => {
    const matchType = typeFilter === 'all' || n.type === typeFilter
    const matchRead = !showUnreadOnly || !n.read
    return matchType && matchRead
  })

  const unreadCount = notifications.filter((n) => !n.read).length

  return (
    <div className="flex-1 flex flex-col min-h-screen bg-bg">
      {/* Header */}
      <div className="px-6 py-5 border-b border-border bg-surface">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-text-primary">Notifications</h1>
            <p className="text-text-muted text-sm mt-0.5">
              {unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'}
            </p>
          </div>
          {unreadCount > 0 && (
            <button
              onClick={markAllRead}
              className="text-sm text-accent hover:text-accent/80 font-medium transition-colors"
            >
              Mark all as read
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 px-6 py-6 space-y-5">
        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 bg-surface border border-border rounded-lg p-1">
            {typeFilters.map((f) => (
              <button
                key={f.value}
                onClick={() => setTypeFilter(f.value)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  typeFilter === f.value
                    ? 'bg-accent text-white'
                    : 'text-text-secondary hover:text-text-primary hover:bg-surface2'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          <button
            onClick={() => setShowUnreadOnly(!showUnreadOnly)}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-medium transition-colors ${
              showUnreadOnly
                ? 'bg-accent-bg border-accent/30 text-accent'
                : 'bg-surface border-border text-text-secondary hover:text-text-primary'
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${showUnreadOnly ? 'bg-accent' : 'bg-text-muted'}`} />
            Unread only
          </button>
        </div>

        {/* Cards */}
        {notifLoading ? (
          <div className="text-center text-text-muted text-sm py-12">Loading notifications...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-10 h-10 text-text-muted mx-auto mb-3">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
            <p className="text-text-muted text-sm">No notifications</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((n) => (
              <NotificationCard key={n._id} notification={n} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
