import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Avatar, Field, Page, Section } from '../components/ui'
import { useAuth } from '../lib/auth'
import { fullName } from '../lib/format'
import { useQuery } from '../lib/hooks'
import { q, supabase } from '../lib/supabase'
import { confirmAction, inTelegram } from '../lib/telegram'
import { toast, toastError } from '../lib/toast'
import type { Player, PlayerClaim } from '../lib/types'

type IncomingClaim = PlayerClaim & {
  player: Pick<Player, 'id' | 'first_name' | 'last_name' | 'photo_url'>
  claimant: { display_name: string; username: string | null } | null
}

export default function ProfilePage() {
  const { userId, profile, refreshProfile, signOut } = useAuth()
  const [name, setName] = useState(profile?.display_name ?? '')

  useEffect(() => setName(profile?.display_name ?? ''), [profile])

  const { data, reload } = useQuery(async () => {
    const [me, incoming] = await Promise.all([
      q(supabase.from('players').select('*').eq('linked_profile_id', userId!).maybeSingle()),
      q(
        supabase
          .from('player_claims')
          .select('*, player:players!inner(id, first_name, last_name, photo_url, created_by), claimant:profiles(display_name, username)')
          .eq('status', 'pending')
          .eq('player.created_by', userId!),
      ),
    ])
    return { me: me as Player | null, incoming: incoming as unknown as IncomingClaim[] }
  }, [userId])

  async function saveName() {
    if (!name.trim() || name.trim() === profile?.display_name) return
    try {
      await q(supabase.from('profiles').update({ display_name: name.trim() }).eq('id', userId!))
      await refreshProfile()
      toast('Имя сохранено')
    } catch (e) {
      toastError(e)
    }
  }

  async function decide(claimId: string, approve: boolean) {
    try {
      await q(supabase.rpc('decide_player_claim', { p_claim: claimId, p_approve: approve }))
      reload()
    } catch (e) {
      toastError(e)
    }
  }

  return (
    <Page title="Профиль">
      <Section title="Вы">
        <div className="card form">
          <Field label="Имя, которое видят другие">
            <input value={name} onChange={(e) => setName(e.target.value)} onBlur={saveName} />
          </Field>
          {profile?.username && <p className="muted small">Telegram: @{profile.username}</p>}
          <div className="profile-id">
            <span className="muted small">ID профиля</span>
            <code>{userId}</code>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => navigator.clipboard?.writeText(userId ?? '').then(() => toast('ID скопирован'))}
            >
              Копировать
            </button>
          </div>
        </div>
      </Section>

      <Section title="Мой игрок">
        {data?.me ? (
          <Link to={`/players/${data.me.id}`} className="row card">
            <Avatar src={data.me.photo_url} name={fullName(data.me)} size={40} />
            <div className="row-main">
              <div className="row-title">{fullName(data.me)} <span className="verified">✓</span></div>
              <div className="row-sub">Ваш профиль игрока</div>
            </div>
            <span className="chevron">›</span>
          </Link>
        ) : (
          <div className="card state">
            Найдите себя в разделе <Link to="/players">Игроки</Link> и нажмите «Это я». Если вас там нет — создайте игрока, а потом нажмите «Это я».
          </div>
        )}
      </Section>

      {data && data.incoming.length > 0 && (
        <Section title="Ждут подтверждения">
          <div className="list card">
            {data.incoming.map((c) => (
              <div key={c.id} className="row">
                <Avatar src={c.player.photo_url} name={fullName(c.player)} size={36} />
                <div className="row-main">
                  <div className="row-title">{c.claimant?.display_name ?? 'Пользователь'} → {fullName(c.player)}</div>
                  <div className="row-sub">говорит, что это он(а)</div>
                </div>
                <button className="btn btn-primary btn-sm" onClick={() => decide(c.id, true)}>
                  Да
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => decide(c.id, false)}>
                  Нет
                </button>
              </div>
            ))}
          </div>
        </Section>
      )}

      {!inTelegram && (
        <Section title="Тестовый режим">
          <div className="card form">
            <p className="muted small">
              Пока нет бота, вход анонимный: у каждого браузера свой пользователь. Чтобы проверить приложение за другого человека, выйдите или откройте вкладку
              инкогнито.
            </p>
            <button
              className="btn btn-secondary btn-block"
              onClick={async () => {
                if (await confirmAction('Выйти? Этот тестовый пользователь будет потерян.')) signOut()
              }}
            >
              Выйти
            </button>
          </div>
        </Section>
      )}
    </Page>
  )
}
