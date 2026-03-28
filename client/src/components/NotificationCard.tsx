import type { Notification, NotificationType } from '../types'
import { useStore } from '../store/useStore'

interface NotificationCardProps {
  notification: Notification
}

const typeConfig: Record<NotificationType, { icon: React.ReactNode; color: string; bg: string }> = {
  fine: {
    bg: 'bg-red-bg',
    color: 'text-red',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
    ),
  },
  toll: {
    bg: 'bg-amber-bg',
    color: 'text-amber',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
    ),
  },
  rego: {
    bg: 'bg-purple-bg',
    color: 'text-purple',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
      </svg>
    ),
  },
  whatsapp: {
    bg: 'bg-green-bg',
    color: 'text-green',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
        <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
      </svg>
    ),
  },
  info: {
    bg: 'bg-accent-bg',
    color: 'text-accent',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="16" x2="12" y2="12" />
        <line x1="12" y1="8" x2="12.01" y2="8" />
      </svg>
    ),
  },
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  if (hours < 24) return `${hours}h ago`
  return `${days}d ago`
}

export default function NotificationCard({ notification }: NotificationCardProps) {
  const { markRead } = useStore()
  const cfg = typeConfig[notification.type]

  return (
    <div
      className={`bg-surface rounded-xl border border-border p-4 flex gap-4 transition-opacity ${
        notification.read ? 'opacity-60' : ''
      }`}
    >
      {/* Icon */}
      <div className={`w-9 h-9 rounded-lg ${cfg.bg} flex items-center justify-center ${cfg.color} shrink-0 mt-0.5`}>
        {cfg.icon}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h4 className="font-semibold text-text-primary text-sm">{notification.title}</h4>
            {notification.plate && (
              <span className="text-xs font-mono text-accent">{notification.plate}</span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs text-text-muted whitespace-nowrap">{timeAgo(notification.date)}</span>
            {!notification.read && (
              <span className="w-2 h-2 rounded-full bg-accent shrink-0" />
            )}
          </div>
        </div>
        <p className="text-text-secondary text-sm mt-1">{notification.description}</p>

        <div className="flex items-center gap-3 mt-2.5">
          {notification.actionRequired && !notification.read && (
            <span className="text-xs bg-red-bg text-red px-2 py-0.5 rounded-full font-medium">Action Required</span>
          )}
          {!notification.read && (
            <button
              onClick={() => markRead(notification._id)}
              className="text-xs text-text-muted hover:text-accent transition-colors font-medium"
            >
              Mark as read
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
