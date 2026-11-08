import { useState } from 'react'
import { Link } from 'react-router-dom'
import { CALIBRATION_MATCHES, RATING_START, type PlayerRating, type RatingChange } from '../lib/rating'
import type { RatingsData } from '../lib/ratingData'
import type { Position } from '../lib/types'
import { POSITIONS, plural } from '../lib/format'
import { Sheet, TeamBadge } from './ui'

/** Что важнее всего для рейтинга на каждой позиции */
const HOW: Record<Position | 'NONE', string> = {
  GK: 'Главное — результат команды, сухие матчи и как можно меньше пропущенных. Голы и передачи почти не влияют.',
  DEF: 'Важнее всего пропущенные командой, сухие матчи и результат. Голы и передачи дают небольшую прибавку.',
  MID: 'Баланс: голы и передачи весят одинаково, плюс результат команды и немного — пропущенные.',
  FWD: 'Главное — голы, передачи весят вдвое меньше. Результат команды влияет слабее, пропущенные не учитываются.',
  UNI: 'Учитывается всё: в матчах, где вы основной вратарь, — как вратарь (сухие, пропущенные), в остальных — как полевой (голы, передачи, результат).',
  NONE: 'Позиция не указана — считаем как полузащитника: голы, передачи и результат команды.',
}

const tone = (d: number) => (d > 0.05 ? 'up' : d < -0.05 ? 'down' : 'flat')
const signed = (d: number) => {
  const v = Math.abs(d).toFixed(1)
  return v === '0.0' ? '±0' : `${d > 0 ? '+' : '−'}${v.replace('.', ',')}`
}

export function RatingBadge({ rating, position, data }: { rating: PlayerRating; position: Position | null; data: RatingsData }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button className={`ovr-badge ${rating.provisional ? 'provisional' : ''}`} onClick={() => setOpen(true)} aria-label="Рейтинг игрока">
        <span className="ovr-value">{rating.ovr}</span>
        <span className="ovr-label">{rating.provisional ? 'OVR?' : 'OVR'}</span>
      </button>
      <Sheet open={open} title="Рейтинг игрока" onClose={() => setOpen(false)}>
        <RatingDetails rating={rating} position={position} data={data} />
      </Sheet>
    </>
  )
}

function RatingDetails({ rating: r, position, data }: { rating: PlayerRating; position: Position | null; data: RatingsData }) {
  const recent = [...r.history].reverse().slice(0, 10)
  const last = r.history[r.history.length - 1]
  return (
    <div className="ovr-details">
      <div className="ovr-head">
        <div className={`ovr-big ${r.provisional ? 'provisional' : ''}`}>{r.ovr}</div>
        <div>
          <div className="ovr-head-title">{position ? POSITIONS[position] : 'Позиция не указана'}</div>
          <div className="muted small">
            {r.matches} {plural(r.matches, 'матч', 'матча', 'матчей')}
            {last && <> · последний матч: <span className={`delta ${tone(last.delta)}`}>{signed(last.delta)}</span></>}
          </div>
        </div>
      </div>

      {r.provisional && (
        <p className="ovr-note">
          Предварительный рейтинг: до {CALIBRATION_MATCHES} матчей он меняется в 2–3 раза быстрее, чтобы быстрее найти ваш уровень.
          {r.matches < CALIBRATION_MATCHES && ` Осталось ${CALIBRATION_MATCHES - r.matches}.`}
        </p>
      )}

      <h3 className="ovr-h">Что это за цифра</h3>
      <p className="small">
        Рейтинг от 50 до 99 по системе ELO. Все начинают с {RATING_START}. После каждого завершённого матча рейтинг пересчитывается из
        двух частей:
      </p>
      <ul className="ovr-list small">
        <li>
          <b>Командная</b> — победа, ничья или поражение с учётом силы составов: обыграть сильных — дорого, проиграть слабым — больно.
          Крупный счёт усиливает эффект.
        </li>
        <li>
          <b>Личная</b> — вклад в игру по позиции. {HOW[position ?? 'NONE']}
        </li>
        <li>
          Карточки и автоголы — минус. Победа в турнире +0,75 всей команде, лучший игрок турнира +1,5.
        </li>
      </ul>
      <p className="muted small">Обычно рейтинг меняется на 0–1 за матч, за яркий матч — до 2,5.</p>

      {r.points.length > 1 && (
        <>
          <h3 className="ovr-h">Динамика</h3>
          <Chart points={r.points} />
        </>
      )}

      {recent.length > 0 && (
        <>
          <h3 className="ovr-h">Последние матчи</h3>
          <div className="list card">
            {recent.map((c) => {
              const opp = data.teams.get(c.opponent_team_id)
              return (
                <Link key={c.match_id} to={`/tournaments/${c.tournament_id}/matches/${c.match_id}`} className="row">
                  {opp && <TeamBadge color={opp.color} />}
                  <div className="row-main">
                    <div className="row-title">
                      {resultWord(c)} {c.goals_for}:{c.goals_against} · {opp?.name ?? 'соперник'}
                    </div>
                    <div className="row-sub">{reasons(c).join(' · ')}</div>
                  </div>
                  <span className={`delta ${tone(c.delta)}`}>{signed(c.delta)}</span>
                </Link>
              )
            })}
          </div>
        </>
      )}

      {r.bonuses.length > 0 && (
        <p className="muted small">
          Бонусы:{' '}
          {r.bonuses
            .map((b) => `${b.kind === 'mvp' ? '⭐ лучший игрок' : '🏆 победа'} «${data.tournaments.get(b.tournament_id)?.name ?? 'турнир'}» ${signed(b.delta)}`)
            .join(', ')}
        </p>
      )}
    </div>
  )
}

function resultWord(c: RatingChange) {
  return c.result === 'W' ? 'Победа' : c.result === 'D' ? 'Ничья' : 'Поражение'
}

/** Короткие причины изменения: что дало результат матча и личная игра */
function reasons(c: RatingChange): string[] {
  const out: string[] = []
  if (c.role === 'GK') out.push(c.goals_against === 0 ? 'в воротах, сухой матч' : `в воротах, пропущено ${c.goals_against}`)
  const diff = c.opp_avg - c.team_avg
  if (diff > 2) out.push('соперник сильнее')
  else if (diff < -2) out.push('соперник слабее')
  if (c.goals) out.push(`${c.goals} ${plural(c.goals, 'гол', 'гола', 'голов')}`)
  if (c.assists) out.push(`${c.assists} ${plural(c.assists, 'передача', 'передачи', 'передач')}`)
  if (c.penalties < 0) out.push(`карточки/автоголы ${signed(c.penalties)}`)
  out.push(`команда ${signed(c.team * c.calibration)}, личное ${signed(c.personal * c.calibration)}`)
  return out
}

function Chart({ points }: { points: number[] }) {
  const w = 320
  const h = 120
  const pad = 6
  const lo = Math.floor(Math.min(...points) - 1)
  const hi = Math.ceil(Math.max(...points) + 1)
  const x = (i: number) => pad + (i * (w - 2 * pad)) / Math.max(1, points.length - 1)
  const y = (v: number) => pad + ((hi - v) * (h - 2 * pad)) / (hi - lo)
  const d = points.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const startY = y(RATING_START)
  return (
    <div className="ovr-chart">
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label="График рейтинга">
        {RATING_START > lo && RATING_START < hi && <line x1={pad} x2={w - pad} y1={startY} y2={startY} className="ovr-chart-base" />}
        <path d={`${d} L${x(points.length - 1)},${h - pad} L${pad},${h - pad} Z`} className="ovr-chart-fill" />
        <path d={d} className="ovr-chart-line" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="ovr-chart-axis muted small">
        <span>старт {RATING_START}</span>
        <span>
          мин {Math.round(Math.min(...points))} · макс {Math.round(Math.max(...points))}
        </span>
      </div>
    </div>
  )
}
