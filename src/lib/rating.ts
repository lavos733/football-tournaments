// Рейтинг игрока (OVR 50–99) по системе ELO: командная часть + личный вклад по позиции.
// Считается целиком из истории завершённых матчей — отдельно нигде не хранится.
import type { Match, MatchEvent, MatchGoalkeeper, Player, Position, RosterEntry, Tournament } from './types'

/** Роль, в которой игрок оценивается в конкретном матче */
export type MatchRole = 'GK' | 'DEF' | 'MID' | 'FWD'

export const RATING_START = 65
export const RATING_MIN = 50
export const RATING_MAX = 99
/** Сколько первых матчей рейтинг калибруется (меняется сильнее) */
export const CALIBRATION_MATCHES = 10

/** Разница рейтингов, при которой фаворит побеждает в ~91% случаев (аналог 400 в классическом ELO) */
const SCALE = 20
/** Сдвиг за командный результат: победа над равным ≈ +K/2 */
const K_TEAM = 1.2
/** Множитель личного вклада */
const K_PERSONAL = 0.5
/** Предел изменения за матч у откалиброванного игрока */
const MAX_DELTA = 2.5

const PENALTY = { yellow: -0.3, red: -1.0, own_goal: -0.6 }
const BONUS = { mvp: 1.5, champion: 0.75 }

/** Как роль весит компоненты матча */
const ROLE: Record<MatchRole, { team: number; goal: number; assist: number; conceded: number; clean: number }> = {
  //       командный результат | гол | ассист | каждый пропущенный ниже среднего | сухой матч
  GK:  { team: 1.0, goal: 0.3, assist: 0.3, conceded: 0.6,  clean: 0.8 },
  DEF: { team: 1.0, goal: 0.5, assist: 0.5, conceded: 0.35, clean: 0.4 },
  MID: { team: 0.9, goal: 0.7, assist: 0.7, conceded: 0.15, clean: 0.15 },
  FWD: { team: 0.7, goal: 1.0, assist: 0.5, conceded: 0,    clean: 0 },
}

export interface RatingChange {
  match_id: string
  tournament_id: string
  opponent_team_id: string
  role: MatchRole
  before: number
  after: number
  delta: number
  /** составляющие изменения (до калибровочного множителя и ограничения) */
  team: number
  personal: number
  penalties: number
  result: 'W' | 'D' | 'L'
  goals_for: number
  goals_against: number
  goals: number
  assists: number
  /** средний рейтинг своего состава и соперника перед матчем */
  team_avg: number
  opp_avg: number
  calibration: number
}

export interface TournamentBonus {
  tournament_id: string
  kind: 'mvp' | 'champion'
  delta: number
}

export interface PlayerRating {
  player_id: string
  rating: number
  /** округлённое значение для показа */
  ovr: number
  matches: number
  provisional: boolean
  history: RatingChange[]
  bonuses: TournamentBonus[]
  /** рейтинг после каждого матча и бонуса, начиная со стартового — для графика */
  points: number[]
}

export interface RatingInput {
  players: Pick<Player, 'id' | 'position'>[]
  tournaments: Pick<Tournament, 'id' | 'created_at' | 'mvp_player_id' | 'winner_team_id' | 'status'>[]
  roster: Pick<RosterEntry, 'tournament_id' | 'tournament_team_id' | 'player_id'>[]
  matches: Match[]
  events: MatchEvent[]
  goalkeepers: MatchGoalkeeper[]
  absences: { match_id: string; player_id: string }[]
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x))
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : RATING_START)

/** Роль игрока в матче: основной вратарь матча — всегда GK, остальные — по своей позиции (вратарь в поле считается защитником). */
export function matchRole(position: Position | null, isMatchKeeper: boolean): MatchRole {
  if (isMatchKeeper) return 'GK'
  if (position === 'FWD' || position === 'DEF') return position
  if (position === 'GK') return 'DEF'
  return 'MID' // MID, UNI в поле и позиция не указана
}

export function computeRatings(input: RatingInput): Map<string, PlayerRating> {
  const out = new Map<string, PlayerRating>()
  const get = (id: string) => {
    let r = out.get(id)
    if (!r) out.set(id, (r = { player_id: id, rating: RATING_START, ovr: RATING_START, matches: 0, provisional: true, history: [], bonuses: [], points: [RATING_START] }))
    return r
  }
  const position = new Map(input.players.map((p) => [p.id, p.position]))
  input.players.forEach((p) => get(p.id))

  const tOrder = [...input.tournaments].sort((a, b) => a.created_at.localeCompare(b.created_at))
  const absent = new Set(input.absences.map((a) => `${a.match_id}:${a.player_id}`))
  const keeper = new Map(input.goalkeepers.map((g) => [`${g.match_id}:${g.team_id}`, g.player_id]))
  const eventsBy = new Map<string, MatchEvent[]>()
  input.events.forEach((e) => eventsBy.set(e.match_id, [...(eventsBy.get(e.match_id) ?? []), e]))

  // среднее число пропущенных командой за матч — накапливается по ходу истории (априори 1.5)
  let gaSum = 1.5 * 4
  let gaCnt = 4

  for (const t of tOrder) {
    const matches = input.matches
      .filter((m) => m.tournament_id === t.id && m.status === 'finished' && m.home_score != null && m.away_score != null)
      .sort((a, b) => a.circle - b.circle || a.matchday - b.matchday || a.position - b.position)
    const rosterOf = (teamId: string) =>
      input.roster.filter((r) => r.tournament_team_id === teamId).map((r) => r.player_id)

    for (const m of matches) {
      const evs = eventsBy.get(m.id) ?? []
      const sides = [
        { team: m.home_team_id, gf: m.home_score!, ga: m.away_score! },
        { team: m.away_team_id, gf: m.away_score!, ga: m.home_score! },
      ].map((s) => ({ ...s, lineup: rosterOf(s.team).filter((p) => !absent.has(`${m.id}:${p}`)) }))
      const avgOf = (ids: string[]) => avg(ids.map((id) => get(id).rating))
      const avgs = sides.map((s) => avgOf(s.lineup))
      const baselineGA = gaSum / gaCnt

      const updates: [string, number, RatingChange][] = []
      sides.forEach((s, i) => {
        const teamAvg = avgs[i]
        const oppAvg = avgs[1 - i]
        const expected = 1 / (1 + Math.pow(10, (oppAvg - teamAvg) / SCALE))
        const score = s.gf > s.ga ? 1 : s.gf === s.ga ? 0.5 : 0
        const gd = Math.abs(s.gf - s.ga)
        const gdMult = 1 + 0.15 * Math.max(0, Math.min(gd, 5) - 1)
        const teamBase = K_TEAM * (score - expected) * gdMult

        for (const pid of s.lineup) {
          const pr = get(pid)
          const role = matchRole(position.get(pid) ?? null, keeper.get(`${m.id}:${s.team}`) === pid)
          const w = ROLE[role]
          const goals = evs.filter((e) => e.type === 'goal' && e.player_id === pid).length
          const assists = evs.filter((e) => e.type === 'goal' && e.assist_player_id === pid).length
          const own = evs.filter((e) => e.type === 'own_goal' && e.player_id === pid).length
          const yellow = evs.filter((e) => e.type === 'yellow' && e.player_id === pid).length
          const red = evs.filter((e) => e.type === 'red' && e.player_id === pid).length

          // личный вклад: голы/ассисты и оборона относительно среднего уровня,
          // против более сильного соперника (относительно себя) стоит дороже
          const attack = w.goal * goals + w.assist * assists
          const defense = w.conceded * (baselineGA - s.ga) + (s.ga === 0 ? w.clean : 0)
          // ожидаемый вклад: средний по матчу у равного по силе полевого — ~0.25 очка атаки
          const expectedAttack = (w.goal + w.assist) * 0.25
          const oppFactor = clamp(Math.pow(10, (oppAvg - pr.rating) / (2 * SCALE)), 0.6, 1.6)
          const personal = K_PERSONAL * (attack - expectedAttack + defense) * (attack - expectedAttack + defense > 0 ? oppFactor : 1 / oppFactor)
          const team = teamBase * w.team
          const penalties = PENALTY.yellow * yellow + PENALTY.red * red + PENALTY.own_goal * own

          const calibration = pr.matches < CALIBRATION_MATCHES ? 1 + 1.5 * (1 - pr.matches / CALIBRATION_MATCHES) : 1
          const raw = clamp(team + personal + penalties, -MAX_DELTA, MAX_DELTA) * calibration
          updates.push([pid, raw, {
            match_id: m.id, tournament_id: t.id, opponent_team_id: sides[1 - i].team, role,
            before: pr.rating, after: pr.rating, delta: 0,
            team, personal, penalties,
            result: score === 1 ? 'W' : score === 0.5 ? 'D' : 'L',
            goals_for: s.gf, goals_against: s.ga, goals, assists,
            team_avg: teamAvg, opp_avg: oppAvg, calibration,
          }])
        }
      })
      // применяем одновременно, чтобы порядок игроков не влиял на ожидания
      for (const [pid, raw, ch] of updates) {
        const pr = get(pid)
        const next = clamp(pr.rating + raw, RATING_MIN, RATING_MAX)
        ch.after = next
        ch.delta = next - pr.rating
        pr.rating = next
        pr.matches++
        pr.history.push(ch)
        pr.points.push(next)
      }
      gaSum += sides[0].ga + sides[1].ga
      gaCnt += 2
    }

    if (t.status === 'finished') {
      const bonus = (pid: string, kind: TournamentBonus['kind']) => {
        const pr = get(pid)
        const next = clamp(pr.rating + BONUS[kind], RATING_MIN, RATING_MAX)
        pr.bonuses.push({ tournament_id: t.id, kind, delta: next - pr.rating })
        pr.rating = next
        pr.points.push(next)
      }
      if (t.winner_team_id) input.roster.filter((r) => r.tournament_team_id === t.winner_team_id).forEach((r) => bonus(r.player_id, 'champion'))
      if (t.mvp_player_id) bonus(t.mvp_player_id, 'mvp')
    }
  }

  for (const r of out.values()) {
    r.ovr = Math.round(r.rating)
    r.provisional = r.matches < CALIBRATION_MATCHES
  }
  return out
}
