/** UNI — универсал: играет и в поле, и в воротах */
export type Position = 'GK' | 'DEF' | 'MID' | 'FWD' | 'UNI'
export type TournamentStatus = 'draft' | 'active' | 'finished'
export type Format = 5 | 8

export interface Profile {
  id: string
  display_name: string
  telegram_id: number | null
  username: string | null
  /** администратор: правит любого игрока и рассматривает все заявки «Это я» (до миграции 011 поля нет) */
  is_admin?: boolean
}

export interface Player {
  id: string
  first_name: string
  last_name: string
  photo_url: string | null
  position: Position | null
  birth_date: string | null
  created_by: string
  linked_profile_id: string | null
  created_at: string
}

export interface PlayerClaim {
  id: string
  player_id: string
  profile_id: string
  status: 'pending' | 'approved' | 'rejected'
  created_at: string
}

export interface Team {
  id: string
  name: string
  color: string
  logo_url: string | null
  created_by: string
  created_at: string
}

export interface Tournament {
  id: string
  name: string
  format: Format
  rounds: number
  /** длительность матча, минут */
  match_minutes: number
  status: TournamentStatus
  mvp_player_id: string | null
  winner_team_id: string | null
  created_by: string
  created_at: string
}

export interface Series {
  id: string
  name: string
  created_by: string
  created_at: string
}

export interface TournamentTeam {
  id: string
  tournament_id: string
  team_id: string | null
  name: string
  color: string
  seed: number | null
  created_at: string
}

export interface RosterEntry {
  id: string
  tournament_id: string
  tournament_team_id: string
  player_id: string
  number: number | null
}

export interface Match {
  id: string
  tournament_id: string
  circle: number
  matchday: number
  position: number
  home_team_id: string
  away_team_id: string
  home_score: number | null
  away_score: number | null
  status: MatchStatus
  /** секунд оставалось в момент timer_since */
  timer_left: number | null
  /** когда таймер запущен; null — на паузе */
  timer_since: string | null
}

export type MatchStatus = 'scheduled' | 'live' | 'finished'
export type EventType = 'goal' | 'own_goal' | 'yellow' | 'red'

export interface MatchEvent {
  id: string
  match_id: string
  type: EventType
  /** гол/автогол — команда, которой засчитан; карточка — команда игрока */
  team_id: string
  player_id: string | null
  assist_player_id: string | null
  /** сколько секунд прошло с начала матча (по таймеру); null — таймера не было или событие старше миграции 012 */
  match_second?: number | null
  created_at: string
}

/** Вратарь команды с начала матча */
export interface MatchGoalkeeper {
  match_id: string
  team_id: string
  player_id: string
}

/** Замена вратаря по ходу матча: player_id встал в ворота на match_second секунде */
export interface MatchGkChange {
  id: string
  match_id: string
  team_id: string
  player_id: string
  match_second: number | null
  created_at: string
}

export interface PlayerStats {
  player_id: string
  matches: number
  wins: number
  draws: number
  losses: number
  goals: number
  assists: number
  own_goals: number
  yellow_cards: number
  red_cards: number
  /** сколько раз лучший игрок турнира */
  mvp: number
  /** сколько турниров выиграла его команда */
  titles: number
  gk_matches: number
  clean_sheets: number
  goals_conceded: number
}

export interface PlayerCareerStats extends PlayerStats {
  tournaments: number
}

export interface PlayerTournamentStats extends PlayerStats {
  tournament_id: string
  team_id: string
  tournament_status: TournamentStatus
}
