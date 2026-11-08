import { computeRatings, type PlayerRating } from './rating'
import { q, supabase } from './supabase'
import type { Match, MatchEvent, MatchGoalkeeper, Player, RosterEntry, Tournament, TournamentTeam } from './types'

export interface RatingsData {
  ratings: Map<string, PlayerRating>
  tournaments: Map<string, Pick<Tournament, 'id' | 'name'>>
  teams: Map<string, Pick<TournamentTeam, 'id' | 'name' | 'color'>>
}

/** Загружает историю всех завершённых матчей и пересчитывает рейтинги всех игроков. */
export async function loadRatings(): Promise<RatingsData> {
  const [players, tournaments, teams, roster, matches, events, goalkeepers, absences] = await Promise.all([
    q<Pick<Player, 'id' | 'position'>[]>(supabase.from('players').select('id, position')),
    q<Pick<Tournament, 'id' | 'name' | 'created_at' | 'mvp_player_id' | 'winner_team_id' | 'status'>[]>(
      supabase.from('tournaments').select('id, name, created_at, mvp_player_id, winner_team_id, status'),
    ),
    q<Pick<TournamentTeam, 'id' | 'name' | 'color'>[]>(supabase.from('tournament_teams').select('id, name, color')),
    q<Pick<RosterEntry, 'tournament_id' | 'tournament_team_id' | 'player_id'>[]>(
      supabase.from('roster_entries').select('tournament_id, tournament_team_id, player_id'),
    ),
    all<Match>((a, b) => supabase.from('matches').select('*').eq('status', 'finished').order('id').range(a, b)),
    all<MatchEvent>((a, b) => supabase.from('match_events').select('*').order('id').range(a, b)),
    all<MatchGoalkeeper>((a, b) => supabase.from('match_goalkeepers').select('*').order('match_id').order('team_id').range(a, b)),
    q<{ match_id: string; player_id: string }[]>(supabase.from('match_absences').select('match_id, player_id')),
  ])
  return {
    ratings: computeRatings({ players, tournaments, roster, matches, events, goalkeepers, absences }),
    tournaments: new Map(tournaments.map((t) => [t.id, t])),
    teams: new Map(teams.map((t) => [t.id, t])),
  }
}

/** Supabase отдаёт не больше 1000 строк за запрос — дочитываем страницами. */
async function all<T>(page: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += 1000) {
    const rows = await q<T[]>(page(from, from + 999))
    out.push(...rows)
    if (rows.length < 1000) return out
  }
}
