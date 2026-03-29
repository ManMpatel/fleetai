import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import { useStore } from '../store/useStore'

const navItems = [
  {
    to: '/',
    label: 'Fleet',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5 shrink-0">
        <rect x="1" y="3" width="15" height="13" rx="2" />
        <path d="M16 8h4l3 3v5h-7V8z" />
        <circle cx="5.5" cy="18.5" r="2.5" />
        <circle cx="18.5" cy="18.5" r="2.5" />
      </svg>
    ),
  },
  {
    to: '/renters',
    label: 'Renters',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5 shrink-0">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    ),
  },
  {
    to: '/notifications',
    label: 'Notifications',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5 shrink-0">
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </svg>
    ),
  },
  {
    to: '/chat',
    label: 'AI Assistant',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5 shrink-0">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    ),
  },
]

export default function Sidebar() {
  const { darkMode, toggleDarkMode, notifications } = useStore()
  const [collapsed, setCollapsed] = useState(false)
  const unread = notifications.filter((n) => !n.read).length

  return (
    <>
      {/* Mobile overlay */}
      {!collapsed && (
        <div
          className="fixed inset-0 bg-black/20 z-30 md:hidden"
          onClick={() => setCollapsed(true)}
        />
      )}

      <aside className={`flex flex-col h-screen bg-sidebar border-r border-sidebar-border shrink-0 transition-all duration-300 z-40 relative ${
        collapsed ? 'w-[60px]' : 'w-[220px]'
      }`}>

        {/* Logo + hamburger */}
        <div className="flex items-center justify-between px-3 py-4 border-b border-sidebar-border min-h-[60px]">
          {!collapsed && (
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-logo-accent/20 flex items-center justify-center shrink-0">
                <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4">
                  <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" fill="var(--logo-accent)" />
                </svg>
              </div>
              <span className="text-sidebar-text-active font-semibold text-[15px] tracking-tight">
                Fleet<span className="text-logo-accent">AI</span>
              </span>
            </div>
          )}
          {collapsed && (
            <div className="w-7 h-7 rounded-lg bg-logo-accent/20 flex items-center justify-center mx-auto">
              <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4">
                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" fill="var(--logo-accent)" />
              </svg>
            </div>
          )}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className={`p-1.5 rounded-lg hover:bg-sidebar-active transition-colors text-sidebar-text hover:text-sidebar-text-active ${collapsed ? 'mx-auto' : ''}`}
          >
            {collapsed ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            )}
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-2 py-4 space-y-0.5">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              title={collapsed ? item.label : undefined}
              className={({ isActive }) =>
                `flex items-center gap-3 px-2.5 py-2.5 rounded-lg text-sm font-medium transition-colors relative group ${
                  isActive
                    ? 'bg-sidebar-active text-sidebar-text-active'
                    : 'text-sidebar-text hover:text-sidebar-text-active hover:bg-sidebar-active/50'
                } ${collapsed ? 'justify-center' : ''}`
              }
            >
              <div className="relative">
                {item.icon}
                {item.label === 'Notifications' && unread > 0 && collapsed && (
                  <span className="absolute -top-1 -right-1 w-2 h-2 bg-red rounded-full" />
                )}
              </div>
              {!collapsed && <span>{item.label}</span>}
              {!collapsed && item.label === 'Notifications' && unread > 0 && (
                <span className="ml-auto bg-red text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
                  {unread > 99 ? '99+' : unread}
                </span>
              )}
              {/* Tooltip when collapsed */}
              {collapsed && (
                <div className="absolute left-full ml-2 px-2 py-1 bg-sidebar-active text-sidebar-text-active text-xs rounded-md opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50">
                  {item.label}
                  {item.label === 'Notifications' && unread > 0 && ` (${unread})`}
                </div>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Footer */}
        <div className="px-2 py-3 border-t border-sidebar-border space-y-0.5">
          <button
            onClick={toggleDarkMode}
            title={collapsed ? (darkMode ? 'Light Mode' : 'Dark Mode') : undefined}
            className={`flex items-center gap-3 px-2.5 py-2.5 rounded-lg text-sm font-medium text-sidebar-text hover:text-sidebar-text-active hover:bg-sidebar-active/50 transition-colors w-full ${
              collapsed ? 'justify-center' : ''
            }`}
          >
            {darkMode ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5 shrink-0">
                <circle cx="12" cy="12" r="5" />
                <line x1="12" y1="1" x2="12" y2="3" />
                <line x1="12" y1="21" x2="12" y2="23" />
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                <line x1="1" y1="12" x2="3" y2="12" />
                <line x1="21" y1="12" x2="23" y2="12" />
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5 shrink-0">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            )}
            {!collapsed && <span>{darkMode ? 'Light Mode' : 'Dark Mode'}</span>}
          </button>

          <div className={`flex items-center gap-3 px-2.5 py-2.5 rounded-lg ${collapsed ? 'justify-center' : ''}`}>
            <div className="w-7 h-7 rounded-full bg-accent/20 flex items-center justify-center text-accent text-xs font-bold shrink-0">
              O
            </div>
            {!collapsed && (
              <div className="flex-1 min-w-0">
                <p className="text-sidebar-text-active text-xs font-medium truncate">Owner</p>
                <p className="text-sidebar-text text-[11px] truncate">Sydney Fleet</p>
              </div>
            )}
          </div>
        </div>
      </aside>
    </>
  )
}