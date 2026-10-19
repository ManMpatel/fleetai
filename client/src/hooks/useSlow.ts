import { useEffect, useState } from 'react'

/**
 * true once `active` has stayed true for `ms` milliseconds. Keeps a button calm for quick actions and
 * switches to a "Preparing the PDF..." message with a moving bar only when the wait is noticeable.
 */
export function useSlow(active: boolean, ms = 600): boolean {
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    if (!active) { setSlow(false); return }
    const timer = setTimeout(() => setSlow(true), ms)
    return () => clearTimeout(timer)
  }, [active, ms])
  return slow
}
