interface StatCardProps {
  label: string
  value: number | string
  icon: React.ReactNode
  color?: 'accent' | 'green' | 'amber' | 'red' | 'purple'
  sub?: string
}

const colorMap = {
  accent: { bg: 'bg-accent-bg', text: 'text-accent', icon: 'text-accent' },
  green: { bg: 'bg-green-bg', text: 'text-green', icon: 'text-green' },
  amber: { bg: 'bg-amber-bg', text: 'text-amber', icon: 'text-amber' },
  red: { bg: 'bg-red-bg', text: 'text-red', icon: 'text-red' },
  purple: { bg: 'bg-purple-bg', text: 'text-purple', icon: 'text-purple' },
}

export default function StatCard({ label, value, icon, color = 'accent', sub }: StatCardProps) {
  const c = colorMap[color]
  return (
    <div className="bg-surface rounded-xl border border-border p-4 flex items-center gap-4">
      <div className={`w-10 h-10 rounded-lg ${c.bg} flex items-center justify-center ${c.icon} shrink-0`}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-text-muted text-xs font-medium uppercase tracking-wide">{label}</p>
        <p className={`text-2xl font-bold ${c.text} leading-tight`}>{value}</p>
        {sub && <p className="text-text-muted text-xs mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}
