import { createClient, processLock } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
// новый формат ключа (sb_publishable_…) или старый anon-ключ
const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY) as string | undefined

export const isConfigured = Boolean(url && key)

// processLock — блокировка сессии внутри одной копии приложения. Стандартная (navigator.locks) общая
// для всех копий: в Telegram зависшая в фоне копия могла держать её, и вход вставал на «Входим…».
export const supabase = createClient(url ?? 'http://localhost', key ?? 'missing', { auth: { lock: processLock } })

/** Стереть сохранённую сессию Supabase из браузера (если она испорчена или зависла). */
export function clearStoredSession() {
  for (const k of Object.keys(localStorage)) if (k.startsWith('sb-')) localStorage.removeItem(k)
}

/** Промис с ограничением по времени: вместо вечного ожидания — понятная ошибка. */
export function withTimeout<T>(p: PromiseLike<T>, ms: number, step: string): Promise<T> {
  return Promise.race([
    Promise.resolve(p),
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`Сервер не ответил (${step}). Проверьте интернет и попробуйте снова.`)), ms)),
  ])
}

/** Достаёт data из ответа Supabase или бросает его ошибку. Тип результата указывается приведением на месте вызова. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function q<T = any>(req: PromiseLike<{ data: unknown; error: unknown }>): Promise<T> {
  const { data, error } = await req
  if (error) throw error
  return data as T
}

/** Человеческий текст ошибки. */
export function errText(e: unknown): string {
  const err = (e ?? {}) as { message?: string; code?: string }
  const msg = err.message ?? ''
  if (err.code === '23505') {
    if (msg.includes('roster_entries_tournament_id_player_id')) return 'Этот игрок уже заявлен в другой команде турнира'
    if (msg.includes('roster_entries_tournament_team_id_number')) return 'Этот номер уже занят в команде'
    if (msg.includes('tournament_teams_tournament_id_name')) return 'Команда с таким названием уже есть в турнире'
    if (msg.includes('linked_profile_id')) return 'Этот профиль уже привязан к другому игроку'
    return 'Такая запись уже существует'
  }
  if (err.code === '23503') return 'Нельзя удалить: запись используется (например, игрок заявлен в турнире)'
  if (err.code === '42501') return 'Нет прав на это действие'
  return msg || 'Что-то пошло не так'
}

/** Загрузка фото: обрезаем по центру в квадрат 512×512 и сохраняем в JPEG. */
export async function uploadPhoto(file: File, userId: string): Promise<string> {
  const blob = await squareJpeg(file, 512)
  const path = `${userId}/${crypto.randomUUID()}.jpg`
  const { error } = await supabase.storage.from('photos').upload(path, blob, { contentType: 'image/jpeg' })
  if (error) throw error
  return supabase.storage.from('photos').getPublicUrl(path).data.publicUrl
}

async function squareJpeg(file: File, size: number): Promise<Blob> {
  const bmp = await createImageBitmap(file)
  const side = Math.min(bmp.width, bmp.height)
  const out = Math.min(size, side)
  const canvas = document.createElement('canvas')
  canvas.width = out
  canvas.height = out
  canvas.getContext('2d')!.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, out, out)
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Не удалось обработать фото'))), 'image/jpeg', 0.85),
  )
}
