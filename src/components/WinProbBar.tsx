import { useEffect, useState } from 'react'
import { probabilityTimeline, winProbability, type Fatigue, type Outcome, type ProbPoint } from '../lib/winProb'
import type { MatchStatus } from '../lib/types'

type Side = { name: string; color: string }
type Key = keyof Outcome
type Goal = { sec: number; home: boolean }

/** Проценты, которые в сумме дают ровно 100 (метод наибольшего остатка) */
function percents(o: Outcome): Outcome {
  const keys: Key[] = ['home', 'draw', 'away']
  const raw = keys.map((k) => o[k] * 100)
  const out = raw.map(Math.floor)
  const order = raw.map((x, i) => [x - Math.floor(x), i] as const).sort((a, b) => b[0] - a[0])
  for (let k = 0; k < 100 - out.reduce((a, b) => a + b, 0); k++) out[order[k]![1]]!++
  return { home: out[0]!, draw: out[1]!, away: out[2]! }
}

const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`

/**
 * Карточка шансов П1 / Н / П2 под таймером — в духе линии букмекера:
 * по строке на исход с мини-графиком и «до матча → сейчас»; по нажатию — большой график по ходу матча.
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
  /** голы со временем; null — у части голов нет времени, графика не будет */
  goals: Goal[] | null
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

  const live = status === 'live'
  const finished = status === 'finished'
  const pre = percents(winProbability(diff, 0, 0, matchSeconds, fatigue))
  const cur = percents(status === 'scheduled' ? winProbability(diff, 0, 0, matchSeconds, fatigue) : winProbability(diff, lead, now ?? 0, matchSeconds, fatigue, finished))

  // график: во время матча — до текущей секунды, после — до финального свистка (или гола в добавленное время)
  const goalSecs = (goals ?? []).map((g) => g.sec)
  const until = finished ? Math.max(matchSeconds - (timerLeft ?? 0), ...goalSecs) : live ? Math.max(now ?? 0, ...goalSecs) : 0
  const points = status !== 'scheduled' && goals != null && until > 0 ? probabilityTimeline(diff, fatigue, goals, until, matchSeconds, finished) : null

  const rows: { key: Key; name: string; color: string }[] = [
    { key: 'home', name: home.name, color: home.color },
    { key: 'draw', name: 'Ничья', color: 'var(--wp-draw)' },
    { key: 'away', name: away.name, color: away.color },
  ]
  const moment = points && goals ? turningPoint(points, goals, home, away) : null
  const caption = status === 'scheduled' ? 'прогноз' : live ? 'до матча → сейчас' : 'до матча → итог'

  return (
    <div className="card wp">
      <div
        className={`wp-main ${points ? 'wp-clickable' : ''}`}
        onClick={points ? () => setOpen((x) => !x) : undefined}
        role={points ? 'button' : undefined}
        aria-expanded={points ? open : undefined}
      >
        <div className="wp-head">
          <span className="wp-title">Шансы на победу</span>
          <span className="wp-caption">{caption}</span>
        </div>
        {fatigue !== 0 && <div className="wp-note">🥵 {fatigue === 1 ? home.name : away.name} — второй матч подряд, к концу силы проседают</div>}
        {rows.map((r) => {
          const delta = cur[r.key] - pre[r.key]
          const tone = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat'
          return (
            <div key={r.key} className="wp-row">
              <span className="wp-name">
                <i className="wp-dot" style={{ background: r.color }} />
                {r.name}
              </span>
              <span className="wp-spark">{points && <Sparkline points={points} k={r.key} color={r.color} />}</span>
              <span className="wp-value">
                {status === 'scheduled' ? (
                  <b className="wp-pill">{cur[r.key]}%</b>
                ) : (
                  <>
                    <b className={`wp-pill wp-${tone}`}>
                      {pre[r.key]} → {cur[r.key]}%
                    </b>
                    <small className={`wp-delta wp-${tone}`}>{delta === 0 ? '±0' : `${delta > 0 ? '+' : '−'}${Math.abs(delta)}`}</small>
                  </>
                )}
              </span>
            </div>
          )
        })}
      </div>

      {open && points && <BigChart points={points} rows={rows} goals={goals!} until={until} />}

      {points && (
        <div className="wp-foot">
          {moment ? (
            <span className="wp-moment">
              Перелом: <b>⚽ {moment.time} {moment.team}</b> <span className="wp-up">+{moment.jump}%</span>
            </span>
          ) : (
            <span className="muted small">{goals!.length === 0 ? 'Голов пока нет' : ''}</span>
          )}
          <button className="wp-toggle" onClick={() => setOpen((x) => !x)}>
            {open ? 'Свернуть ▴' : 'График ▾'}
          </button>
        </div>
      )}
    </div>
  )
}

/** Гол, сильнее всего изменивший шансы забившей команды на победу */
function turningPoint(points: ProbPoint[], goals: Goal[], home: Side, away: Side) {
  let best: { time: string; team: string; jump: number } | null = null
  for (const g of goals) {
    const before = [...points].reverse().find((p) => p.sec < g.sec)
    const after = points.find((p) => p.sec >= g.sec)
    if (!before || !after) continue
    const k: Key = g.home ? 'home' : 'away'
    const jump = Math.round((after[k] - before[k]) * 100)
    if (!best || jump > best.jump) best = { time: clock(g.sec), team: g.home ? home.name : away.name, jump }
  }
  return best && best.jump > 0 ? best : null
}

function Sparkline({ points, k, color }: { points: ProbPoint[]; k: Key; color: string }) {
  const w = 100
  const h = 28
  const last = points[points.length - 1]!.sec || 1
  const xy = points.map((p) => `${((p.sec / last) * w).toFixed(1)},${(h - 2 - p[k] * (h - 4)).toFixed(1)}`)
  const id = `wp-grad-${k}`
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.25" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`M${xy.join(' L')} L${w},${h} L0,${h} Z`} fill={`url(#${id})`} />
      <path d={`M${xy.join(' L')}`} fill="none" stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  )
}

/** Большой график: три линии исходов, сетка 0–100%, минуты по оси, пунктир — голы */
function BigChart({ points, rows, goals, until }: { points: ProbPoint[]; rows: { key: Key; color: string }[]; goals: Goal[]; until: number }) {
  const W = 340
  const H = 180
  const L = 34
  const R = 8
  const T = 14
  const B = 22
  const x = (sec: number) => L + (sec / until) * (W - L - R)
  const y = (p: number) => T + (1 - p) * (H - T - B)
  const step = until <= 360 ? 60 : 120
  const ticks: number[] = []
  for (let s = 0; s <= until; s += step) ticks.push(s)
  return (
    <div className="wp-chart">
      <svg viewBox={`0 0 ${W} ${H}`} aria-label="Как менялись шансы по ходу матча">
        {[0, 0.25, 0.5, 0.75, 1].map((p) => (
          <g key={p}>
            <line x1={L} x2={W - R} y1={y(p)} y2={y(p)} className="wp-grid" />
            <text x={L - 6} y={y(p) + 3.5} className="wp-axis" textAnchor="end">
              {p * 100}%
            </text>
          </g>
        ))}
        {ticks.map((s) => (
          <g key={s}>
            <line x1={x(s)} x2={x(s)} y1={T} y2={H - B} className="wp-grid" />
            <text x={x(s)} y={H - 6} className="wp-axis" textAnchor="middle">
              {clock(s)}
            </text>
          </g>
        ))}
        {goals.map((g, i) => (
          <g key={i}>
            <line x1={x(g.sec)} x2={x(g.sec)} y1={T} y2={H - B} className="wp-goal" />
            <text x={x(g.sec)} y={T - 3} textAnchor="middle" className="wp-goal-icon">
              ⚽
            </text>
          </g>
        ))}
        {rows.map((r) => (
          <path
            key={r.key}
            d={`M${points.map((p) => `${x(p.sec).toFixed(1)},${y(p[r.key]).toFixed(1)}`).join(' L')}`}
            fill="none"
            stroke={r.color}
            strokeWidth={2.2}
            strokeLinejoin="round"
          />
        ))}
      </svg>
    </div>
  )
}
