import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { PlayerPicker } from '../components/PlayerPicker'
import { TeamForm } from '../components/TeamForm'
import { Avatar, ErrorBox, Loading, Page, Section, TeamBadge } from '../components/ui'
import { useAuth } from '../lib/auth'
import { POS_SHORT, ROSTER_LIMITS, fullName } from '../lib/format'
import { useQuery } from '../lib/hooks'
import { q, supabase } from '../lib/supabase'
import { confirmAction } from '../lib/telegram'
import { toastError } from '../lib/toast'
import type { Player, RosterEntry, Tournament, TournamentTeam } from '../lib/types'

type Entry = RosterEntry & { player: Player }
type TakenRow = { player_id: string; tournament_team_id: string }

export default function TournamentTeamPage() {
  const { id, teamId } = useParams()
  const nav = useNavigate()
  const { userId } = useAuth()
  const [picking, setPicking] = useState(false)
  const [editing, setEditing] = useState(false)

  const { data, loading, error, reload } = useQuery(async () => {
    const [t, teams, roster, taken, judges] = await Promise.all([
      q(supabase.from('tournaments').select('*').eq('id', id!).single()),
      q(supabase.from('tournament_teams').select('*').eq('tournament_id', id!)),
      q(supabase.from('roster_entries').select('*, player:players(*)').eq('tournament_team_id', teamId!)),
      q(supabase.from('roster_entries').select('player_id, tournament_team_id').eq('tournament_id', id!)),
      q(supabase.from('tournament_judges').select('profile_id').eq('tournament_id', id!)),
    ])
    return {
      t: t as Tournament,
      teams: teams as TournamentTeam[],
      roster: roster as Entry[],
      taken: taken as TakenRow[],
      judges: (judges as { profile_id: string }[]).map((j) => j.profile_id),
    }
  }, [id, teamId])

  const back = `/tournaments/${id}`
  if (loading && !data) return <Page title="Команда" back={back}><Loading /></Page>
  if (error || !data) return <Page title="Команда" back={back}><ErrorBox text={error ?? 'Не найдено'} onRetry={reload} /></Page>

  const { t, teams, taken } = data
  const team = teams.find((x) => x.id === teamId)
  if (!team) return <Page title="Команда" back={back}><ErrorBox text="Команда не найдена" /></Page>

  const canManage = t.created_by === userId || data.judges.includes(userId!)
  const canEditRoster = canManage && t.status !== 'finished'
  const canEditTeam = canManage && t.status === 'draft'
  const [min, max] = ROSTER_LIMITS[t.format]
  const roster = [...data.roster].sort((a, b) => (a.number ?? 999) - (b.number ?? 999) || fullName(a.player).localeCompare(fullName(b.player), 'ru'))
  const count = roster.length
  const ok = count >= min && count <= max

  const teamName = new Map(teams.map((x) => [x.id, x.name]))
  const disabled: Record<string, string> = Object.fromEntries(
    taken.map((r) => [r.player_id, r.tournament_team_id === team.id ? 'уже в составе' : `в команде «${teamName.get(r.tournament_team_id)}»`]),
  )

  async function addPlayer(p: Player) {
    if (count >= max) {
      toastError({ message: `В заявке максимум ${max} игроков для формата ${t.format}×${t.format}` })
      return
    }
    try {
      const used = new Set(roster.map((r) => r.number))
      // предлагаем первый свободный номер — его легко поменять
      let number = 1
      while (used.has(number)) number++
      await q(supabase.from('roster_entries').insert({ tournament_id: t.id, tournament_team_id: team!.id, player_id: p.id, number }))
      reload()
    } catch (e) {
      toastError(e)
    }
  }

  async function setNumber(entry: Entry, input: HTMLInputElement) {
    const raw = input.value.trim()
    const number = raw === '' ? null : Number(raw)
    if (number === entry.number) return
    const revert = () => (input.value = entry.number === null ? '' : String(entry.number))
    if (number !== null && (!Number.isInteger(number) || number < 0 || number > 99)) {
      toastError({ message: 'Номер — от 0 до 99' })
      revert()
      return
    }
    try {
      await q(supabase.from('roster_entries').update({ number }).eq('id', entry.id))
      reload()
    } catch (e) {
      toastError(e)
      revert()
    }
  }

  async function removeEntry(entry: Entry) {
    try {
      await q(supabase.from('roster_entries').delete().eq('id', entry.id))
      reload()
    } catch (e) {
      toastError(e)
    }
  }

  async function removeTeam() {
    if (!(await confirmAction(`Убрать команду «${team!.name}» из турнира?`))) return
    try {
      await q(supabase.from('matches').delete().eq('tournament_id', t.id))
      await q(supabase.from('tournament_teams').delete().eq('id', team!.id))
      nav(back)
    } catch (e) {
      toastError(e)
    }
  }

  return (
    <Page
      title={team.name}
      back={back}
      actions={
        canEditTeam && (
          <button className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>
            Изменить
          </button>
        )
      }
    >
      <div className="hero card">
        <TeamBadge color={team.color} size={48} />
        <div className="hero-name">{team.name}</div>
        <div className="hero-sub">{t.name}</div>
      </div>

      <Section
        title={`Заявка · ${count} из ${min}–${max}`}
        right={
          canEditRoster &&
          count < max && (
            <button className="btn btn-ghost btn-sm" onClick={() => setPicking(true)}>
              + Игрок
            </button>
          )
        }
      >
        {!ok && <div className="notice">Для формата {t.format}×{t.format} в заявке должно быть от {min} до {max} игроков.</div>}
        {roster.length === 0 ? (
          <div className="card state">В заявке пока никого нет</div>
        ) : (
          <div className="list card">
            {roster.map((r) => (
              <div key={r.id} className="row">
                {canEditRoster ? (
                  <input
                    className="number-input"
                    inputMode="numeric"
                    defaultValue={r.number ?? ''}
                    key={`${r.id}-${r.number}`}
                    onBlur={(e) => setNumber(r, e.currentTarget)}
                    aria-label="Номер"
                  />
                ) : (
                  <span className="number">{r.number ?? '–'}</span>
                )}
                <Link to={`/players/${r.player.id}`} className="row-link">
                  <Avatar src={r.player.photo_url} name={fullName(r.player)} size={36} />
                  <div className="row-main">
                    <div className="row-title">{fullName(r.player)}</div>
                    <div className="row-sub">{r.player.position ? POS_SHORT[r.player.position] : '—'}</div>
                  </div>
                </Link>
                {canEditRoster && (
                  <button className="icon-btn" onClick={() => removeEntry(r)} aria-label="Убрать из заявки">
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>

      {canEditTeam && (
        <button className="btn btn-danger-ghost btn-block" onClick={removeTeam}>
          Убрать команду из турнира
        </button>
      )}

      <PlayerPicker
        open={picking}
        title="Добавить в заявку"
        disabled={disabled}
        onClose={() => setPicking(false)}
        onPick={(p) => {
          setPicking(false)
          addPlayer(p)
        }}
      />
      <TeamForm
        open={editing}
        title="Команда в турнире"
        initial={team}
        submitLabel="Сохранить"
        onClose={() => setEditing(false)}
        onSubmit={async (v) => {
          try {
            await q(supabase.from('tournament_teams').update(v).eq('id', team.id))
            setEditing(false)
            reload()
          } catch (e) {
            toastError(e)
          }
        }}
      />
    </Page>
  )
}
