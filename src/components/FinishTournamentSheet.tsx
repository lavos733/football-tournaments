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
}: {
  value: string
  onChange(id: string): void
  teams: TournamentTeam[]
  players: Map<string, MiniPlayer>
  rosterTeam: Map<string, string>
  disabled?: boolean
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
      <option value="">— не выбран —</option>
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

export function FinishTournamentSheet({
  open,
  winner,
  teams,
  players,
  rosterTeam,
  stats,
  initialMvp,
  onClose,
  onSubmit,
}: {
  open: boolean
  winner: TournamentTeam | undefined
  teams: TournamentTeam[]
  players: Map<string, MiniPlayer>
  rosterTeam: Map<string, string>
  stats: PlayerTournamentStats[]
  initialMvp: string | null
  onClose(): void
  onSubmit(mvpId: string | null): Promise<void>
}) {
  const [mvp, setMvp] = useState('')
  const [busy, setBusy] = useState(false)

  // подсказка: по умолчанию — лучший по «гол + пас»
  useEffect(() => {
    if (!open) return
    if (initialMvp) return setMvp(initialMvp)
    const best = [...stats].sort((a, b) => b.goals + b.assists - (a.goals + a.assists) || b.goals - a.goals)[0]
    setMvp(best && best.goals + best.assists > 0 ? best.player_id : '')
  }, [open, initialMvp, stats])

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
        <button
          className="btn btn-primary btn-block"
          disabled={busy || !winner}
          onClick={async () => {
            setBusy(true)
            try {
              await onSubmit(mvp || null)
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
