// Вход через Telegram Mini App.
// Приложение присылает initData; функция проверяет подпись ботом и выдаёт одноразовый токен,
// которым клиент получает обычную сессию Supabase (verifyOtp).
// Секрет: TELEGRAM_BOT_TOKEN (Supabase → Edge Functions → Secrets).
import { createClient } from 'jsr:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

async function hmac(key: Uint8Array, data: string): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(data)))
}

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('')

/** Проверка подписи по документации Telegram: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app */
async function verifyInitData(initData: string, botToken: string): Promise<URLSearchParams | null> {
  const params = new URLSearchParams(initData)
  const hash = params.get('hash')
  if (!hash) return null
  params.delete('hash')
  const check = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n')
  const secret = await hmac(new TextEncoder().encode('WebAppData'), botToken)
  return hex(await hmac(secret, check)) === hash ? params : null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN')
    if (!botToken) return json({ error: 'На сервере не задан TELEGRAM_BOT_TOKEN' }, 500)

    const { initData } = await req.json()
    const params = typeof initData === 'string' ? await verifyInitData(initData, botToken) : null
    if (!params) return json({ error: 'Не удалось проверить вход через Telegram' }, 401)

    const authDate = Number(params.get('auth_date'))
    if (!authDate || Date.now() / 1000 - authDate > 24 * 60 * 60) {
      return json({ error: 'Данные Telegram устарели — закройте и откройте приложение заново' }, 401)
    }

    const tgUser = JSON.parse(params.get('user') ?? 'null') as
      | { id: number; first_name: string; last_name?: string; username?: string }
      | null
    if (!tgUser?.id) return json({ error: 'Telegram не передал пользователя' }, 400)

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    // один Telegram-аккаунт = один пользователь Supabase с техническим email
    const email = `tg${tgUser.id}@telegram.user`
    const displayName = [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ') || tgUser.username || 'Игрок'

    let link = await admin.auth.admin.generateLink({ type: 'magiclink', email })
    if (link.error) {
      const created = await admin.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: { display_name: displayName, telegram_id: tgUser.id },
      })
      if (created.error) throw created.error
      link = await admin.auth.admin.generateLink({ type: 'magiclink', email })
      if (link.error) throw link.error
    }

    const userId = link.data.user.id
    const { error: profileError } = await admin
      .from('profiles')
      .update({ telegram_id: tgUser.id, username: tgUser.username ?? null })
      .eq('id', userId)
    if (profileError) throw profileError

    return json({ token_hash: link.data.properties.hashed_token })
  } catch (e) {
    console.error(e)
    return json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})
