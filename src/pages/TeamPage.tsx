import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { PlayerPicker } from '../components/PlayerPicker'
import { TeamForm } from '../components/TeamForm'
import { Avatar, ErrorBox, Loading, Page, Section, TeamBadge } from '../components/ui'
import { useAuth } from '../lib/auth'
import { POS_SHORT, fullName, playersCount } from '../lib/format'
import { useQuery } from '../lib/hooks'
import { q, supabase } from '../lib/supabase'
import { confirmAction } from '../lib/telegram'
import { toastError } from '../lib/toast'
import type { Player, Team } from '../lib/types'

type TeamRow = Team & { creator: { display_name: string } | null; team_players: { player: Player }[] }

export default function TeamPage() {
  const { id } = useParams()
  const nav = useNavigate()
  const { userId } = useAuth()
  const [editing, setEditing] = useState(false)
  const [picking, setPicking] = useState(false)

  const { data, loading, error, reload } = useQuery(
    () => q(supabase.from('teams').select('*, creator:profiles!teams_created_by_fkey(display_name), team_players(player:players(*))').eq('id', id!).single()),
    [id],
  )

  if (loading && !data) return <Page title="Команда" back="/teams"><Loading /></Page>
  if (error || !data) return <Page title="Команда" back="/teams"><ErrorBox text={error ?? 'Не найдено'} onRetry={reload} /></Page>

  const team = data as unknown as TeamRow
  const isOwner = team.created_by === userId
  const players = team.team_players.map((tp) => tp.player).sort((a, b) => fullName(a).localeCompare(fullName(b), 'ru'))
  const inTeam = Object.fromEntries(players.map((p) => [p.id, 'уже в составе']))

  async function addPlayer(p: Player) {
    try {
      await q(supabase.from('team_players').insert({ team_id: team.id, player_id: p.id }))
      reload()
    } catch (e) {
      toastError(e)
    }
  }

  async function removePlayer(p: Player) {
    try {
      await q(supabase.from('team_players').delete().eq('team_id', team.id).eq('player_id', p.id))
      reload()
    } catch (e) {
      toastError(e)
    }
  }

  async function remove() {
    if (!(await confirmAction(`Удалить команду «${team.name}» из базы? Прошедшие турниры не изменятся.`))) return
    try {
      await q(supabase.from('teams').delete().eq('id', team.id))
      nav('/teams')
    } catch (e) {
      toastError(e)
    }
  }

  return (
    <Page
      title={team.name}
      back="/teams"
      actions={
        isOwner && (
          <button className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>
            Изменить
          </button>
        )
      }
    >
      <div className="hero card">
        <TeamBadge color={team.color} size={56} />
        <div className="hero-name">{team.name}</div>
        <div className="hero-sub">Создал: {team.creator?.display_name ?? '—'}</div>
      </div>

      <Section
        title={`Обычный состав · ${playersCount(players.length)}`}
        right={
          isOwner && (
            <button className="btn btn-ghost btn-sm" onClick={() => setPicking(true)}>
              + Игрок
            </button>
          )
        }
      >
        {players.length === 0 ? (
          <div className="card state">
            Состав пуст. Игроки из обычного состава автоматически попадут в заявку, когда команда добавляется в турнир.
          </div>
        ) : (
          <div className="list card">
            {players.map((p) => (
              <div key={p.id} className="row">
                <Link to={`/players/${p.id}`} className="row-link">
                  <Avatar src={p.photo_url} name={fullName(p)} size={36} />
                  <div className="row-main">
                    <div className="row-title">{fullName(p)}</div>
                    <div className="row-sub">{p.position ? POS_SHORT[p.position] : '—'}</div>
                  </div>
                </Link>
                {isOwner && (
                  <button className="icon-btn" onClick={() => removePlayer(p)} aria-label="Убрать">
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>

      {isOwner && (
        <button className="btn btn-danger-ghost btn-block" onClick={remove}>
          Удалить команду
        </button>
      )}

      <TeamForm
        open={editing}
        title="Команда"
        initial={team}
        submitLabel="Сохранить"
        onClose={() => setEditing(false)}
        onSubmit={async (v) => {
          try {
            await q(supabase.from('teams').update(v).eq('id', team.id))
            setEditing(false)
            reload()
          } catch (e) {
            toastError(e)
          }
        }}
      />
      <PlayerPicker
        open={picking}
        disabled={inTeam}
        onClose={() => setPicking(false)}
        onPick={(p) => {
          setPicking(false)
          addPlayer(p)
        }}
      />
    </Page>
  )
}
