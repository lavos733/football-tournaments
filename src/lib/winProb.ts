// Вероятность исхода матча (П1 / Н / П2) по ходу игры.
// Голы каждой команды до конца матча — распределение Пуассона: средний темп нашей лиги,
// сдвинутый разницей рейтингов команд; темп растёт к концу матча (так в нашей истории).
// Коэффициенты подобраны по истории 60 матчей (ноябрь 2026).

/** Голов одной команды за минуту в среднем по истории */
const GOALS_PER_TEAM_MINUTE = 0.128
/** Доля голов матча, забиваемая в каждой пятой части времени: к концу темп растёт почти втрое */
const TIME_SHARES = [0.12, 0.15, 0.13, 0.25, 0.35]
/** Насколько разница рейтингов меняет темп: +20 пунктов — темп сильнее команды ×e^0.5 */
const RATING_WEIGHT = 0.5
const RATING_SCALE = 20
/** Сглаживание уверенности: в 5-минутных матчах у нас много камбэков, «чистая» модель переоценивает лидера */
const TEMPERATURE = 1.5
/**
 * Усталость: команда, сыгравшая предыдущий матч подряд, к концу матча играет как на столько пунктов
 * рейтинга слабее (штраф растёт равномерно с первой секунды). По истории такие команды выигрывали 17 из 56
 * против 24 у отдохнувших соперников.
 */
const FATIGUE_POINTS = 15
/** Пока матч не завершён, гол возможен и на последней секунде — оставляем крошечный шанс */
const MIN_REMAINING_SHARE = 0.02

export interface Outcome {
  home: number
  draw: number
  away: number
}

/** Кто играет второй матч подряд: 1 — хозяева, −1 — гости, 0 — никто (или обе) */
export type Fatigue = 1 | 0 | -1

/**
 * Ожидаемые голы хозяев и гостей до конца матча, если прошла доля времени f (0–1).
 * Время делится на пятые части: в каждой свой темп голов и свой штраф за усталость.
 */
function remainingGoals(f: number, diff: number, fatigue: Fatigue, matchSeconds: number): [number, number] {
  const total = GOALS_PER_TEAM_MINUTE * (matchSeconds / 60)
  let home = 0
  let away = 0
  TIME_SHARES.forEach((share, i) => {
    const lo = Math.max(i / 5, f)
    const hi = (i + 1) / 5
    if (hi <= lo) return
    const mid = (lo + hi) / 2
    const d = diff - fatigue * FATIGUE_POINTS * mid
    const shift = Math.exp((RATING_WEIGHT * d) / RATING_SCALE)
    const base = total * share * (hi - lo) * 5
    home += base * shift
    away += base / shift
  })
  // гол возможен и на последней секунде, пока матч не завершён
  const floor = total * MIN_REMAINING_SHARE
  return [Math.max(home, floor), Math.max(away, floor)]
}

function poisson(mu: number, k: number): number {
  let p = Math.exp(-mu)
  for (let i = 1; i <= k; i++) p *= mu / i
  return p
}

/**
 * Вероятность исхода при текущем счёте и времени.
 * @param diff разница рейтингов: хозяева − гости
 * @param lead текущий перевес хозяев в голах
 * @param elapsed сколько секунд прошло; matchSeconds — длина матча
 * @param fatigue кто играет второй матч подряд
 */
export function winProbability(diff: number, lead: number, elapsed: number, matchSeconds: number, fatigue: Fatigue = 0, finished = false): Outcome {
  if (finished) return lead > 0 ? { home: 1, draw: 0, away: 0 } : lead < 0 ? { home: 0, draw: 0, away: 1 } : { home: 0, draw: 1, away: 0 }
  const f = Math.min(1, Math.max(0, elapsed / matchSeconds))
  const [muHome, muAway] = remainingGoals(f, diff, fatigue, matchSeconds)
  let home = 0
  let draw = 0
  let away = 0
  for (let i = 0; i <= 12; i++) {
    const pi = poisson(muHome, i)
    for (let j = 0; j <= 12; j++) {
      const p = pi * poisson(muAway, j)
      const x = lead + i - j
      if (x > 0) home += p
      else if (x === 0) draw += p
      else away += p
    }
  }
  const [h, d, a] = [home, draw, away].map((x) => Math.pow(x, 1 / TEMPERATURE))
  const sum = h + d + a
  return { home: h / sum, draw: d / sum, away: a / sum }
}

export interface ProbPoint extends Outcome {
  /** секунда матча */
  sec: number
}

/**
 * Как менялись шансы по ходу матча: точка каждые 5 секунд и до/после каждого гола.
 * goals — секунда гола и чей он (true — хозяев); голы без времени не участвуют.
 */
export function probabilityTimeline(
  diff: number,
  fatigue: Fatigue,
  goals: { sec: number; home: boolean }[],
  untilSec: number,
  matchSeconds: number,
  finished: boolean,
): ProbPoint[] {
  const sorted = [...goals].sort((a, b) => a.sec - b.sec)
  const leadAt = (sec: number) => sorted.filter((g) => g.sec <= sec).reduce((s, g) => s + (g.home ? 1 : -1), 0)
  const secs = new Set<number>()
  for (let s = 0; s < untilSec; s += 5) secs.add(s)
  for (const g of sorted) {
    if (g.sec > 0) secs.add(g.sec - 0.001)
    secs.add(g.sec)
  }
  secs.add(untilSec)
  return [...secs]
    .filter((s) => s <= untilSec)
    .sort((a, b) => a - b)
    .map((sec) => ({ sec, ...winProbability(diff, leadAt(sec), sec, matchSeconds, fatigue, finished && sec === untilSec) }))
}
