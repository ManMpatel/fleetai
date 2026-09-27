import { useState, useCallback } from 'react'

const MAX = 10

export function useSearchHistory(storageKey: string) {
  const [history, setHistory] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(storageKey) || '[]')
    } catch {
      return []
    }
  })

  const push = useCallback((term: string) => {
    const t = term.trim()
    if (!t) return
    setHistory(prev => {
      const next = [t, ...prev.filter(x => x.toLowerCase() !== t.toLowerCase())].slice(0, MAX)
      localStorage.setItem(storageKey, JSON.stringify(next))
      return next
    })
  }, [storageKey])

  const remove = useCallback((term: string) => {
    setHistory(prev => {
      const next = prev.filter(x => x !== term)
      localStorage.setItem(storageKey, JSON.stringify(next))
      return next
    })
  }, [storageKey])

  const clear = useCallback(() => {
    localStorage.removeItem(storageKey)
    setHistory([])
  }, [storageKey])

  return { history, push, remove, clear }
}
