import { useCallback, useEffect, useState } from 'react'
import { errText } from './supabase'

/**
 * Загрузка данных с повторным запросом через reload().
 * Пока грузятся данные для новых deps, старые не отдаются: иначе компонент на мгновение
 * получит данные другой формы (например, турниры вместо серий) и упадёт.
 */
export function useQuery<T>(fn: () => Promise<T>, deps: unknown[]) {
  const key = JSON.stringify(deps)
  const [result, setResult] = useState<{ key: string; data: T } | undefined>()
  const [error, setError] = useState<{ key: string; text: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let alive = true
    setLoading(true)
    fn()
      .then((d) => {
        if (!alive) return
        setResult({ key, data: d })
        setError(null)
      })
      .catch((e) => alive && setError({ key, text: errText(e) }))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick])

  const reload = useCallback(() => setTick((t) => t + 1), [])
  const fresh = result?.key === key
  return {
    // при reload() с теми же deps старые данные остаются на экране, пока не придут новые
    data: fresh ? result.data : undefined,
    error: error?.key === key ? error.text : null,
    loading: loading || (!fresh && error?.key !== key),
    reload,
  }
}
