export function SkeletonBar({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse bg-surface2 rounded-md ${className}`} />
}

export function SkeletonCircle({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse bg-surface2 rounded-full shrink-0 ${className}`} />
}

export function SkeletonTableRow({ cols = 6 }: { cols?: number }) {
  return (
    <tr className="border-b border-border last:border-0">
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="px-4 py-3.5">
          <SkeletonBar className="h-4 w-full max-w-[120px]" />
        </td>
      ))}
    </tr>
  )
}

export function SkeletonCard() {
  return (
    <div className="bg-surface border border-border rounded-xl p-5 mb-4">
      <SkeletonBar className="h-4 w-32 mb-4" />
      <div className="grid grid-cols-2 gap-4">
        <SkeletonBar className="h-9 w-full" />
        <SkeletonBar className="h-9 w-full" />
      </div>
    </div>
  )
}

export function SkeletonListRow({ withAvatar = false }: { withAvatar?: boolean }) {
  return (
    <div className="px-4 py-3.5 flex items-center gap-3">
      {withAvatar && <SkeletonCircle className="w-8 h-8" />}
      <div className="flex-1 space-y-2">
        <SkeletonBar className="h-3.5 w-1/3" />
        <SkeletonBar className="h-3 w-1/4" />
      </div>
      <SkeletonBar className="h-5 w-16 rounded-full" />
    </div>
  )
}
