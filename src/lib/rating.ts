// Рейтинг игрока (OVR 50–99) по системе ELO: командная часть + личный вклад по позиции.
// Считается целиком из истории завершённых матчей — отдельно нигде не хранится.
import type { Match, MatchEvent, MatchGkChange, MatchGoalkeeper, Player, Position, RosterEntry, Tournament } from './types'

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
  /** доля матча в воротах (0–1) и пропущено за это время */
  gk_share: number
  gk_conceded: number
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
  tournaments: Pick<Tournament, 'id' | 'created_at' | 'mvp_player_id' | 'winner_team_id' | 'status' | 'match_minutes'>[]
  roster: Pick<RosterEntry, 'tournament_id' | 'tournament_team_id' | 'player_id'>[]
  matches: Match[]
  events: MatchEvent[]
  goalkeepers: MatchGoalkeeper[]
  /** замены вратаря по ходу матча */
  gkChanges?: MatchGkChange[]
  absences: { match_id: string; player_id: string }[]
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x))
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : RATING_START)

/** Роль игрока в поле по его позиции (вратарь в поле считается защитником). */
export function fieldRole(position: Position | null): MatchRole {
  if (position === 'FWD' || position === 'DEF') return position
  if (position === 'GK') return 'DEF'
  return 'MID' // MID, UNI в поле и позиция не указана
}

export interface KeeperSpell {
  /** доля матча в воротах, 0–1 */
  share: number
  /** пропущено, пока стоял в воротах */
  conceded: number
}

/**
 * Кто сколько простоял в воротах команды и сколько пропустил за это время.
 * Стартовый вратарь — с 0-й секунды, дальше каждая замена. Гол засчитывается тому, кто стоял в воротах
 * на секунде гола; если время неизвестно — по порядку записи. Та же логика, что в статистике (миграция 013).
 */
export function keeperSpells(
  m: Pick<Match, 'id' | 'timer_left'>,
  teamId: string,
  matchSeconds: number,
  starter: string | null,
  changes: MatchGkChange[],
  events: MatchEvent[],
): Map<string, KeeperSpell> {
  const starts = [
    ...(starter ? [{ player: starter, sec: 0 as number | null, at: '' }] : []),
    ...changes
      .filter((c) => c.match_id === m.id && c.team_id === teamId)
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((c) => ({ player: c.player_id, sec: c.match_second, at: c.created_at })),
  ]
  const len = m.timer_left == null ? null : matchSeconds - m.timer_left
  const conceded = events.filter((e) => (e.type === 'goal' || e.type === 'own_goal') && e.team_id !== teamId)
  const out = new Map<string, KeeperSpell>()
  starts.forEach((s, i) => {
    const next = starts[i + 1]
    const bySeconds = s.sec != null && (!next || next.sec != null)
    const inSpell = (e: MatchEvent) =>
      e.match_second != null && bySeconds
        ? e.match_second >= s.sec! && (!next || e.match_second < next.sec!)
        : e.created_at >= s.at && (!next || e.created_at < next.at)
    // время неизвестно (не было таймера) — делим матч поровну между отрезками
    const share =
      len && len > 0 && bySeconds ? Math.max(0, ((next ? next.sec! : len) - s.sec!) / len) : 1 / starts.length
    const prev = out.get(s.player) ?? { share: 0, conceded: 0 }
    out.set(s.player, { share: Math.min(1, prev.share + share), conceded: prev.conceded + conceded.filter(inSpell).length })
  })
  return out
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
  const gkChanges = input.gkChanges ?? []
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
        const spells = keeperSpells(m, s.team, t.match_minutes * 60, keeper.get(`${m.id}:${s.team}`) ?? null, gkChanges, evs)

        for (const pid of s.lineup) {
          const pr = get(pid)
          // в воротах — долю матча f, в поле — остальное; веса смешиваются пропорционально
          const spell = spells.get(pid)
          const f = spell?.share ?? 0
          const field = ROLE[fieldRole(position.get(pid) ?? null)]
          const gkw = ROLE.GK
          const mix = (k: 'team' | 'goal' | 'assist') => f * gkw[k] + (1 - f) * field[k]
          const role: MatchRole = f >= 0.5 ? 'GK' : fieldRole(position.get(pid) ?? null)
          const goals = evs.filter((e) => e.type === 'goal' && e.player_id === pid).length
          const assists = evs.filter((e) => e.type === 'goal' && e.assist_player_id === pid).length
          const own = evs.filter((e) => e.type === 'own_goal' && e.player_id === pid).length
          const yellow = evs.filter((e) => e.type === 'yellow' && e.player_id === pid).length
          const red = evs.filter((e) => e.type === 'red' && e.player_id === pid).length

          // личный вклад: голы/ассисты и оборона относительно среднего уровня,
          // против более сильного соперника (относительно себя) стоит дороже
          const attack = mix('goal') * goals + mix('assist') * assists
          // оборона в поле — по пропущенным командой; в воротах — по пропущенным за свой отрезок
          const fieldDefense = field.conceded * (baselineGA - s.ga) + (s.ga === 0 ? field.clean : 0)
          const gkConceded = spell?.conceded ?? 0
          const gkDefense = f > 0 ? gkw.conceded * (f * baselineGA - gkConceded) + (gkConceded === 0 && f >= 0.5 ? gkw.clean * f : 0) : 0
          const defense = (1 - f) * fieldDefense + gkDefense
          // ожидаемый вклад: средний по матчу у равного по силе полевого — ~0.25 очка атаки
          const expectedAttack = (mix('goal') + mix('assist')) * 0.25
          const oppFactor = clamp(Math.pow(10, (oppAvg - pr.rating) / (2 * SCALE)), 0.6, 1.6)
          const personal = K_PERSONAL * (attack - expectedAttack + defense) * (attack - expectedAttack + defense > 0 ? oppFactor : 1 / oppFactor)
          const team = teamBase * mix('team')
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
            gk_share: f, gk_conceded: gkConceded,
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
