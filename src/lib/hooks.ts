import { useCallback, useEffect, useState } from 'react'
import { errText } from './supabase'

/** Загрузка данных с повторным запросом через reload(). */
export function useQuery<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | undefined>()
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let alive = true
    setLoading(true)
    fn()
      .then((d) => {
        if (!alive) return
        setData(d)
        setError(null)
      })
      .catch((e) => alive && setError(errText(e)))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick])

  const reload = useCallback(() => setTick((t) => t + 1), [])
  return { data, error, loading, reload }
}
