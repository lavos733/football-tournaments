import { useEffect, useState } from 'react'
import { probabilityTimeline, winProbability, type Fatigue, type Outcome, type ProbPoint } from '../lib/winProb'
import type { MatchStatus } from '../lib/types'

type Side = { name: string; color: string }

/** Проценты, которые в сумме дают ровно 100 (метод наибольшего остатка) */
function percents(o: Outcome): [number, number, number] {
  const raw = [o.home, o.draw, o.away].map((x) => x * 100)
  const out = raw.map(Math.floor)
  const order = raw.map((x, i) => [x - Math.floor(x), i] as const).sort((a, b) => b[0] - a[0])
  for (let k = 0; k < 100 - out.reduce((a, b) => a + b, 0); k++) out[order[k]![1]]!++
  return out as [number, number, number]
}

const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`

/**
 * Полоса шансов П1 / Н / П2 под таймером.
 * До матча — прогноз по рейтингам, во время — с учётом счёта и времени,
 * после — прогноз до начала; по нажатию разворачивается график, как менялись шансы.
 */
export function WinProbBar({
  home,
  away,
  diff,
  fatigue,
  status,
  lead,
  goals,
  matchSeconds,
  timerLeft,
  timerSince,
  clockSkew,
}: {
  home: Side
  away: Side
  /** разница средних рейтингов: хозяева − гости */
  diff: number
  /** кто играет второй матч подряд: 1 — хозяева, −1 — гости */
  fatigue: Fatigue
  status: MatchStatus
  /** текущий перевес хозяев по счёту */
  lead: number
  /** голы со временем (секунда, чей гол); null — у части голов нет времени, графика не будет */
  goals: { sec: number; home: boolean }[] | null
  matchSeconds: number
  timerLeft: number | null
  timerSince: string | null
  clockSkew: number
}) {
  const [open, setOpen] = useState(false)
  const elapsed = () => {
    if (timerLeft == null) return null
    const left = timerSince
      ? Math.max(0, timerLeft - Math.floor((Date.now() + clockSkew - new Date(timerSince).getTime()) / 1000))
      : timerLeft
    return matchSeconds - left
  }
  const [now, setNow] = useState(elapsed)
  useEffect(() => {
    setNow(elapsed())
    if (status !== 'live' || !timerSince) return
    const t = setInterval(() => setNow(elapsed()), 1000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, timerLeft, timerSince, clockSkew, matchSeconds])

  const pre = winProbability(diff, 0, 0, matchSeconds, fatigue)
  const live = status === 'live'
  const shown = live ? winProbability(diff, lead, now ?? 0, matchSeconds, fatigue) : pre
  const [ph, pd, pa] = percents(shown)

  // график: во время матча — до текущей секунды, после — до последнего свистка (или последнего гола в добавленное время)
  const until =
    status === 'finished'
      ? Math.max(matchSeconds - (timerLeft ?? 0), ...(goals ?? []).map((g) => g.sec))
      : live
        ? Math.max(now ?? 0, ...(goals ?? []).map((g) => g.sec))
        : 0
  const canChart = status !== 'scheduled' && goals != null && until > 0
  const caption = status === 'scheduled' ? 'прогноз на матч' : live ? 'сейчас' : 'до начала матча'

  return (
    <div
      className={`card wp ${canChart ? 'wp-clickable' : ''}`}
      onClick={canChart ? () => setOpen((x) => !x) : undefined}
      role={canChart ? 'button' : undefined}
      aria-expanded={canChart ? open : undefined}
    >
      <div className="wp-head">
        <span className="wp-title">Шансы · {caption}</span>
        {live && (
          <span className="muted small">
            до матча {percents(pre).join(' · ')}
          </span>
        )}
        {canChart && <span className="wp-chevron">{open ? '▴' : '▾'}</span>}
      </div>
      {fatigue !== 0 && (
        <div className="muted small">🥵 {fatigue === 1 ? home.name : away.name} — второй матч подряд, к концу силы проседают</div>
      )}
      <div className="wp-bar">
        <i style={{ width: `${shown.home * 100}%`, background: home.color }} />
        <i className="wp-draw" style={{ width: `${shown.draw * 100}%` }} />
        <i style={{ width: `${shown.away * 100}%`, background: away.color }} />
      </div>
      <div className="wp-labels">
        <span>
          {home.name} <b>{ph}%</b>
        </span>
        <span className="muted">
          ничья <b>{pd}%</b>
        </span>
        <span>
          <b>{pa}%</b> {away.name}
        </span>
      </div>
      {open && canChart && (
        <WinProbChart
          points={probabilityTimeline(diff, fatigue, goals!, until, matchSeconds, status === 'finished')}
          goals={goals!}
          home={home}
          away={away}
          until={until}
        />
      )}
    </div>
  )
}

/** Сложенные области: снизу шансы хозяев, посередине ничья, сверху гости. Пунктир — голы. */
function WinProbChart({ points, goals, home, away, until }: { points: ProbPoint[]; goals: { sec: number; home: boolean }[]; home: Side; away: Side; until: number }) {
  const w = 300
  const h = 120
  const x = (sec: number) => (sec / until) * w
  const y = (p: number) => h - p * h
  const area = (lo: (p: ProbPoint) => number, hi: (p: ProbPoint) => number) =>
    `M${points.map((p) => `${x(p.sec).toFixed(1)},${y(hi(p)).toFixed(1)}`).join(' L')} L${[...points]
      .reverse()
      .map((p) => `${x(p.sec).toFixed(1)},${y(lo(p)).toFixed(1)}`)
      .join(' L')} Z`
  return (
    <div className="wp-chart">
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-label="Как менялись шансы по ходу матча">
        <path d={area(() => 0, (p) => p.home)} fill={home.color} opacity={0.85} />
        <path d={area((p) => p.home, (p) => p.home + p.draw)} className="wp-chart-draw" />
        <path d={area((p) => p.home + p.draw, () => 1)} fill={away.color} opacity={0.85} />
        <line x1={0} x2={w} y1={h / 2} y2={h / 2} className="wp-chart-mid" />
        {goals.map((g, i) => (
          <line key={i} x1={x(g.sec)} x2={x(g.sec)} y1={0} y2={h} className="wp-chart-goal" />
        ))}
      </svg>
      <div className="wp-chart-axis muted small">
        <span>0:00</span>
        <span>{clock(until)}</span>
      </div>
      {goals.length > 0 && (
        <div className="muted small">
          ⚽{' '}
          {[...goals]
            .sort((a, b) => a.sec - b.sec)
            .map((g) => `${clock(g.sec)} ${g.home ? home.name : away.name}`)
            .join(' · ')}
        </div>
      )}
    </div>
  )
}
