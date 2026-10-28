import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { errText, q, supabase } from './supabase'
import { inTelegram, tg } from './telegram'
import type { Profile } from './types'

interface AuthState {
  loading: boolean
  /** ошибка входа через Telegram */
  error: string | null
  userId: string | null
  profile: Profile | null
  /** тестовый вход без Telegram — только на localhost */
  signIn(displayName: string): Promise<void>
  signOut(): Promise<void>
  refreshProfile(): Promise<void>
  retry(): void
}

const AuthContext = createContext<AuthState | null>(null)

/** Тестовый анонимный вход разрешён только при разработке на своём компьютере. */
export const browserLoginAllowed = ['localhost', '127.0.0.1'].includes(window.location.hostname)

/** initData → Edge Function telegram-auth → одноразовый токен → сессия Supabase. */
async function telegramSignIn(): Promise<string> {
  const { data, error } = await supabase.functions.invoke('telegram-auth', { body: { initData: tg!.initData } })
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const body = await error.context.json().catch(() => null)
      throw new Error(body?.error ?? 'Не удалось войти через Telegram')
    }
    throw error
  }
  const { data: session, error: otpError } = await supabase.auth.verifyOtp({ token_hash: data.token_hash, type: 'magiclink' })
  if (otpError) throw otpError
  return session.user!.id
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [attempt, setAttempt] = useState(0)

  const loadProfile = useCallback(async (id: string | null) => {
    if (!id) {
      setProfile(null)
      return
    }
    const p = await q(supabase.from('profiles').select('*').eq('id', id).maybeSingle())
    setProfile(p as Profile | null)
  }, [])

  useEffect(() => {
    let alive = true
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const { data } = await supabase.auth.getSession()
        let id = data.session?.user.id ?? null

        if (inTelegram) {
          // заходим заново, если сессии нет или она от другого Telegram-аккаунта
          const tgId = tg?.initDataUnsafe?.user?.id
          if (!id || data.session?.user.user_metadata?.telegram_id !== tgId) {
            if (id) await supabase.auth.signOut()
            id = await telegramSignIn()
          }
        }

        if (!alive) return
        setUserId(id)
        await loadProfile(id)
      } catch (e) {
        if (alive) setError(errText(e))
      } finally {
        if (alive) setLoading(false)
      }
    })()

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (alive) setUserId(session?.user.id ?? null)
    })
    return () => {
      alive = false
      sub.subscription.unsubscribe()
    }
  }, [loadProfile, attempt])

  const signIn = useCallback(
    async (displayName: string) => {
      const { data, error } = await supabase.auth.signInAnonymously({ options: { data: { display_name: displayName } } })
      if (error) throw error
      const id = data.user?.id ?? null
      setUserId(id)
      await loadProfile(id)
    },
    [loadProfile],
  )

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    setUserId(null)
    setProfile(null)
  }, [])

  const refreshProfile = useCallback(() => loadProfile(userId), [loadProfile, userId])
  const retry = useCallback(() => setAttempt((n) => n + 1), [])

  return (
    <AuthContext.Provider value={{ loading, error, userId, profile, signIn, signOut, refreshProfile, retry }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth outside AuthProvider')
  return ctx
}
