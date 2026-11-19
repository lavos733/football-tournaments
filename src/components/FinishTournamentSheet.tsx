import { useEffect, useState } from 'react'
import { fullName } from '../lib/format'
import type { Player, PlayerTournamentStats, TournamentTeam } from '../lib/types'
import { Field, Sheet, TeamBadge } from './ui'

type MiniPlayer = Pick<Player, 'id' | 'first_name' | 'last_name' | 'photo_url'>

/** Выбор лучшего игрока турнира: список всех заявленных, сгруппированный по командам. */
export function MvpSelect({
  value,
  onChange,
  teams,
  players,
  rosterTeam,
  disabled,
  emptyLabel = '— не выбран —',
}: {
  value: string
  onChange(id: string): void
  teams: TournamentTeam[]
  players: Map<string, MiniPlayer>
  rosterTeam: Map<string, string>
  disabled?: boolean
  emptyLabel?: string
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
      <option value="">{emptyLabel}</option>
      {teams.map((team) => (
        <optgroup key={team.id} label={team.name}>
          {[...players.values()]
            .filter((p) => rosterTeam.get(p.id) === team.id)
            .sort((a, b) => fullName(a).localeCompare(fullName(b), 'ru'))
            .map((p) => (
              <option key={p.id} value={p.id}>
                {fullName(p)}
              </option>
            ))}
        </optgroup>
      ))}
    </select>
  )
}

/** Гол турнира для «Премии Пушкаша» */
export interface GoalOption {
  id: string
  player_id: string
  label: string
}

/** Выбор лучшего гола турнира — список всех голов с автором, по турам. */
export function GoalSelect({
  value,
  onChange,
  goals,
  disabled,
}: {
  value: string
  onChange(id: string): void
  goals: GoalOption[]
  disabled?: boolean
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled || goals.length === 0}>
      <option value="">{goals.length === 0 ? '— голов нет —' : '— никому, не выдаём —'}</option>
      {goals.map((g) => (
        <option key={g.id} value={g.id}>
          {g.label}
        </option>
      ))}
    </select>
  )
}

export interface TournamentAwards {
  mvp: string | null
  worst: string | null
  goal: string | null
}

export function FinishTournamentSheet({
  open,
  winner,
  teams,
  players,
  rosterTeam,
  stats,
  goals,
  initialMvp,
  initialWorst,
  initialGoal,
  onClose,
  onSubmit,
}: {
  open: boolean
  winner: TournamentTeam | undefined
  teams: TournamentTeam[]
  players: Map<string, MiniPlayer>
  rosterTeam: Map<string, string>
  stats: PlayerTournamentStats[]
  goals: GoalOption[]
  initialMvp: string | null
  initialWorst: string | null
  initialGoal: string | null
  onClose(): void
  onSubmit(awards: TournamentAwards): Promise<void>
}) {
  const [mvp, setMvp] = useState('')
  const [worst, setWorst] = useState('')
  const [goal, setGoal] = useState('')
  const [busy, setBusy] = useState(false)

  // подсказка: по умолчанию — лучший по «гол + пас»
  useEffect(() => {
    if (!open) return
    // антипремии и премии за гол не угадываем: по умолчанию — не выдаются
    setWorst(initialWorst ?? '')
    setGoal(initialGoal ?? '')
    if (initialMvp) return setMvp(initialMvp)
    const best = [...stats].sort((a, b) => b.goals + b.assists - (a.goals + a.assists) || b.goals - a.goals)[0]
    setMvp(best && best.goals + best.assists > 0 ? best.player_id : '')
    // только при открытии: фоновое обновление данных не должно сбрасывать выбор
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  return (
    <Sheet open={open} title="Завершить турнир" onClose={onClose}>
      <div className="form">
        {winner && (
          <div className="champion card">
            <span className="champion-cup">🏆</span>
            <div>
              <div className="muted small">Победитель по таблице</div>
              <div className="champion-name">
                <TeamBadge color={winner.color} /> {winner.name}
              </div>
            </div>
          </div>
        )}
        <Field label="Лучший игрок турнира" hint="Предложен игрок с наибольшим «гол + пас». Можно выбрать любого или поменять позже.">
          <MvpSelect value={mvp} onChange={setMvp} teams={teams} players={players} rosterTeam={rosterTeam} />
        </Field>
        <Field label="🎯 Премия Пушкаша — лучший гол" hint="+0,5 к рейтингу автора гола. Можно не выдавать.">
          <GoalSelect value={goal} onChange={setGoal} goals={goals} />
        </Field>
        <Field label="🍓 Волчья малина — худший игрок" hint="−0,5 к рейтингу. Можно не выдавать.">
          <MvpSelect value={worst} onChange={setWorst} teams={teams} players={players} rosterTeam={rosterTeam} emptyLabel="— никому, не выдаём —" />
        </Field>
        <button
          className="btn btn-primary btn-block"
          disabled={busy || !winner}
          onClick={async () => {
            setBusy(true)
            try {
              await onSubmit({ mvp: mvp || null, worst: worst || null, goal: goal || null })
            } finally {
              setBusy(false)
            }
          }}
        >
          {busy ? 'Завершаю…' : 'Завершить турнир'}
        </button>
      </div>
    </Sheet>
  )
}
