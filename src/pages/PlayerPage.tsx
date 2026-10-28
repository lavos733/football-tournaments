import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { PlayerForm } from '../components/PlayerForm'
import { Avatar, ErrorBox, Loading, Page, Section, TeamBadge } from '../components/ui'
import { useAuth } from '../lib/auth'
import { POSITIONS, STATUS_LABEL, ageLabel, fullName } from '../lib/format'
import { useQuery } from '../lib/hooks'
import { q, supabase } from '../lib/supabase'
import { confirmAction } from '../lib/telegram'
import { toast, toastError } from '../lib/toast'
import type { Player, PlayerCareerStats, PlayerClaim, PlayerTournamentStats, Tournament, TournamentTeam } from '../lib/types'

type PlayerRow = Player & {
  creator: { display_name: string } | null
  linked: { display_name: string; username: string | null } | null
}
type HistoryRow = {
  number: number | null
  tournament: Pick<Tournament, 'id' | 'name' | 'status' | 'format' | 'created_at'>
  team: Pick<TournamentTeam, 'id' | 'name' | 'color'>
}
type ClaimRow = PlayerClaim & { claimant: { display_name: string; username: string | null } | null }

export default function PlayerPage() {
  const { id } = useParams()
  const nav = useNavigate()
  const { userId } = useAuth()
  const [editing, setEditing] = useState(false)

  const { data, loading, error, reload } = useQuery(async () => {
    const [player, history, claims, myLinked, career, perTournament] = await Promise.all([
      q(
        supabase
          .from('players')
          .select('*, creator:profiles!players_created_by_fkey(display_name), linked:profiles!players_linked_profile_id_fkey(display_name, username)')
          .eq('id', id!)
          .single(),
      ),
      q(
        supabase
          .from('roster_entries')
          .select('number, tournament:tournaments(id, name, status, format, created_at), team:tournament_teams(id, name, color)')
          .eq('player_id', id!),
      ),
      q(supabase.from('player_claims').select('*, claimant:profiles(display_name, username)').eq('player_id', id!).eq('status', 'pending')),
      q(supabase.from('players').select('id').eq('linked_profile_id', userId!).maybeSingle()),
      q(supabase.from('player_stats').select('*').eq('player_id', id!).maybeSingle()),
      q(supabase.from('player_tournament_stats').select('*').eq('player_id', id!)),
    ])
    return {
      career: career as PlayerCareerStats | null,
      perTournament: new Map((perTournament as PlayerTournamentStats[]).map((s) => [s.tournament_id, s])),
      player: player as PlayerRow,
      history: (history as unknown as HistoryRow[]).sort((a, b) => b.tournament.created_at.localeCompare(a.tournament.created_at)),
      claims: claims as ClaimRow[],
      iAmLinkedElsewhere: Boolean(myLinked),
    }
  }, [id, userId])

  if (loading && !data) return <Page title="Игрок" back="/players"><Loading /></Page>
  if (error || !data) return <Page title="Игрок" back="/players"><ErrorBox text={error ?? 'Не найдено'} onRetry={reload} /></Page>

  const { player: p, history, claims } = data
  const isCreator = p.created_by === userId
  const canEdit = isCreator || p.linked_profile_id === userId
  const myClaim = claims.find((c) => c.profile_id === userId)

  async function claim() {
    try {
      const res = await q(supabase.rpc('request_player_claim', { p_player: p.id }))
      toast(res === 'linked' ? 'Готово: это теперь ваш профиль игрока' : 'Заявка отправлена создателю игрока')
      reload()
    } catch (e) {
      toastError(e)
    }
  }

  async function cancelClaim() {
    if (!myClaim) return
    try {
      await q(supabase.from('player_claims').delete().eq('id', myClaim.id))
      reload()
    } catch (e) {
      toastError(e)
    }
  }

  async function decide(claimId: string, approve: boolean) {
    try {
      await q(supabase.rpc('decide_player_claim', { p_claim: claimId, p_approve: approve }))
      toast(approve ? 'Привязка подтверждена' : 'Заявка отклонена')
      reload()
    } catch (e) {
      toastError(e)
    }
  }

  async function remove() {
    if (!(await confirmAction(`Удалить игрока «${fullName(p)}»?`))) return
    try {
      await q(supabase.from('players').delete().eq('id', p.id))
      nav('/players')
    } catch (e) {
      toastError(e)
    }
  }

  return (
    <Page
      title="Игрок"
      back="/players"
      actions={
        canEdit && (
          <button className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>
            Изменить
          </button>
        )
      }
    >
      <div className="hero card">
        <Avatar src={p.photo_url} name={fullName(p)} size={88} />
        <div className="hero-name">
          {fullName(p)} {p.linked_profile_id && <span className="verified">✓</span>}
        </div>
        <div className="hero-sub">{[p.position && POSITIONS[p.position], ageLabel(p.birth_date)].filter(Boolean).join(' · ') || 'Позиция не указана'}</div>
        {p.linked && <div className="hero-note">Профиль подтверждён: {p.linked.display_name}{p.linked.username ? ` (@${p.linked.username})` : ''}</div>}
        {!p.linked_profile_id && !data.iAmLinkedElsewhere && (
          myClaim ? (
            <div className="hero-note">
              Заявка «Это я» ждёт подтверждения ·{' '}
              <button className="link" onClick={cancelClaim}>
                отозвать
              </button>
            </div>
          ) : (
            <button className="btn btn-secondary btn-sm" onClick={claim}>
              Это я
            </button>
          )
        )}
      </div>

      {isCreator && claims.length > 0 && (
        <Section title="Заявки «Это я»">
          <div className="list card">
            {claims.map((c) => (
              <div key={c.id} className="row">
                <div className="row-main">
                  <div className="row-title">{c.claimant?.display_name ?? 'Пользователь'}</div>
                  <div className="row-sub">{c.claimant?.username ? `@${c.claimant.username}` : 'хочет привязать игрока к себе'}</div>
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

      <CareerStats s={data.career} isKeeper={p.position === 'GK'} />

      <Section title={`Турниры · ${history.length}`}>
        {history.length === 0 ? (
          <div className="card state">Ещё не играл в турнирах</div>
        ) : (
          <div className="list card">
            {history.map((h) => (
              <Link key={h.tournament.id} to={`/tournaments/${h.tournament.id}`} className="row">
                <TeamBadge color={h.team.color} />
                <div className="row-main">
                  <div className="row-title">
                    {h.tournament.name}
                    {data.perTournament.get(h.tournament.id)?.titles ? ' 🏆' : ''}
                    {data.perTournament.get(h.tournament.id)?.mvp ? ' ⭐' : ''}
                  </div>
                  <div className="row-sub">
                    {h.team.name}
                    {h.number !== null && ` · №${h.number}`} · {STATUS_LABEL[h.tournament.status]}
                  </div>
                </div>
                {(() => {
                  const s = data.perTournament.get(h.tournament.id)
                  return s && s.matches + s.goals + s.assists > 0 ? (
                    <span className="mini-stats">
                      {s.matches} И · {s.goals} Г · {s.assists} П
                    </span>
                  ) : null
                })()}
                <span className="chevron">›</span>
              </Link>
            ))}
          </div>
        )}
      </Section>

      <p className="muted small center">Добавил: {p.creator?.display_name ?? '—'}</p>
      {isCreator && (
        <button className="btn btn-danger-ghost btn-block" onClick={remove}>
          Удалить игрока
        </button>
      )}

      <PlayerForm
        open={editing}
        player={p}
        onClose={() => setEditing(false)}
        onSaved={() => {
          setEditing(false)
          reload()
        }}
      />
    </Page>
  )
}

function CareerStats({ s, isKeeper }: { s: PlayerCareerStats | null; isKeeper: boolean }) {
  if (!s || (s.matches === 0 && s.goals === 0 && s.assists === 0)) {
    return (
      <Section title="Статистика">
        <div className="card state">Статистика появится после первого сыгранного матча</div>
      </Section>
    )
  }
  const perMatch = (n: number) => (s.matches ? (n / s.matches).toFixed(2).replace('.', ',') : '0')
  const winRate = s.matches ? Math.round((s.wins / s.matches) * 100) : 0
  return (
    <Section title="Статистика за всё время">
      <div className="stats-grid">
        <Stat label="Матчи" value={s.matches} />
        <Stat label="Голы" value={s.goals} />
        <Stat label="Ассисты" value={s.assists} />
        <Stat label="Гол+пас" value={s.goals + s.assists} />
        <Stat label="Голов за матч" value={perMatch(s.goals)} />
        <Stat label="Пасов за матч" value={perMatch(s.assists)} />
        <Stat label="Турниры" value={s.tournaments} />
        <Stat label="🏆 Выиграно турниров" value={s.titles} />
        <Stat label="⭐ Лучший игрок турнира" value={s.mvp} />
        <Stat label="Победы в матчах" value={`${winRate}%`} />
        <Stat label="В-Н-П" value={`${s.wins}-${s.draws}-${s.losses}`} />
        <Stat label="🟨 Жёлтые" value={s.yellow_cards} />
        <Stat label="🟥 Красные" value={s.red_cards} />
      </div>
      {(isKeeper || s.gk_matches > 0) && (
        <div className="stats-grid">
          <Stat label="Матчей в воротах" value={s.gk_matches} />
          <Stat label="Сухие матчи" value={s.clean_sheets} />
          <Stat label="Пропущено" value={s.goals_conceded} />
          <Stat label="Пропущено за матч" value={s.gk_matches ? (s.goals_conceded / s.gk_matches).toFixed(2).replace('.', ',') : '0'} />
        </div>
      )}
      {s.own_goals > 0 && <p className="muted small">Автоголы: {s.own_goals}</p>}
    </Section>
  )
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="stat">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  )
}
