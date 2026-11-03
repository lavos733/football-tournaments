import { useCallback, useEffect, useRef, useState } from 'react'
import { errText } from './supabase'

/**
 * Загрузка данных с повторным запросом через reload().
 * Пока грузятся данные для новых deps, старые не отдаются: иначе компонент на мгновение
 * получит данные другой формы (например, турниры вместо серий) и упадёт.
 *
 * Данные тихо обновляются, когда приложение снова становится видимым, а с refreshMs —
 * ещё и по таймеру (интервал может зависеть от загруженных данных). Ошибка тихого обновления не показывается: на экране остаются старые данные.
 */
export function useQuery<T>(
  fn: () => Promise<T>,
  deps: unknown[],
  opts: { refreshMs?: (data: T) => number | undefined } = {},
) {
  const key = JSON.stringify(deps)
  const [result, setResult] = useState<{ key: string; data: T } | undefined>()
  const [error, setError] = useState<{ key: string; text: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)
  const silent = useRef(false)

  useEffect(() => {
    let alive = true
    const quiet = silent.current && result?.key === key
    silent.current = false
    if (!quiet) setLoading(true)
    fn()
      .then((d) => {
        if (!alive) return
        setResult({ key, data: d })
        setError(null)
      })
      .catch((e) => alive && !quiet && setError({ key, text: errText(e) }))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick])

  const reload = useCallback(() => setTick((t) => t + 1), [])

  const fresh = result?.key === key
  const refreshMs = fresh ? opts.refreshMs?.(result.data) : undefined
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== 'visible') return
      silent.current = true
      setTick((t) => t + 1)
    }
    document.addEventListener('visibilitychange', refresh)
    const timer = refreshMs ? setInterval(refresh, refreshMs) : undefined
    return () => {
      document.removeEventListener('visibilitychange', refresh)
      clearInterval(timer)
    }
  }, [refreshMs])

  return {
    // при reload() с теми же deps старые данные остаются на экране, пока не придут новые
    data: fresh ? result.data : undefined,
    error: error?.key === key ? error.text : null,
    loading: loading || (!fresh && error?.key !== key),
    reload,
  }
}
