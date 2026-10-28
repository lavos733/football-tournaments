import type { Match, TournamentTeam } from './types'

export type FormResult = 'W' | 'D' | 'L'

export interface StandingRow {
  team: TournamentTeam
  played: number
  won: number
  drawn: number
  lost: number
  gf: number
  ga: number
  gd: number
  points: number
  form: FormResult[]
}

type Played = Match & { home_score: number; away_score: number }

function isPlayed(m: Match): m is Played {
  return m.status === 'finished' && m.home_score !== null && m.away_score !== null
}

/** 3 очка за победу, 1 за ничью. Порядок: очки → разница мячей → личные встречи → забитые → название. */
export function computeStandings(teams: TournamentTeam[], matches: Match[]): StandingRow[] {
  const played = matches.filter(isPlayed).sort((a, b) => a.matchday - b.matchday || a.position - b.position)
  const rows = new Map<string, StandingRow>(
    teams.map((team) => [team.id, { team, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, gd: 0, points: 0, form: [] }]),
  )

  for (const m of played) {
    const home = rows.get(m.home_team_id)
    const away = rows.get(m.away_team_id)
    if (!home || !away) continue
    apply(home, m.home_score, m.away_score)
    apply(away, m.away_score, m.home_score)
  }

  const sorted = [...rows.values()].sort((a, b) => b.points - a.points || b.gd - a.gd)

  // личные встречи — внутри групп с равными очками и разницей
  const result: StandingRow[] = []
  for (let i = 0; i < sorted.length; ) {
    let j = i + 1
    while (j < sorted.length && sorted[j]!.points === sorted[i]!.points && sorted[j]!.gd === sorted[i]!.gd) j++
    const group = sorted.slice(i, j)
    if (group.length > 1) {
      const ids = new Set(group.map((r) => r.team.id))
      const h2h = new Map(group.map((r) => [r.team.id, 0]))
      for (const m of played) {
        if (!ids.has(m.home_team_id) || !ids.has(m.away_team_id)) continue
        const [hp, ap] = m.home_score > m.away_score ? [3, 0] : m.home_score < m.away_score ? [0, 3] : [1, 1]
        h2h.set(m.home_team_id, h2h.get(m.home_team_id)! + hp)
        h2h.set(m.away_team_id, h2h.get(m.away_team_id)! + ap)
      }
      group.sort((a, b) => h2h.get(b.team.id)! - h2h.get(a.team.id)! || b.gf - a.gf || a.team.name.localeCompare(b.team.name, 'ru'))
    }
    result.push(...group)
    i = j
  }
  return result
}

function apply(row: StandingRow, scored: number, conceded: number) {
  row.played++
  row.gf += scored
  row.ga += conceded
  row.gd = row.gf - row.ga
  if (scored > conceded) {
    row.won++
    row.points += 3
    row.form.push('W')
  } else if (scored === conceded) {
    row.drawn++
    row.points += 1
    row.form.push('D')
  } else {
    row.lost++
    row.form.push('L')
  }
}
