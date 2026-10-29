import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { fullName } from '../lib/format'
import type { SeriesPointsRow } from '../lib/seriesPoints'
import type { Player } from '../lib/types'
import type { StatsRow } from './TournamentStats'
import { Avatar, Segmented } from './ui'

type MiniPlayer = Pick<Player, 'id' | 'first_name' | 'last_name' | 'photo_url'>
type Players = Map<string, MiniPlayer>

const avg = (n: number, d: number) => (d ? n / d : 0)
const fmt = (n: number) => n.toFixed(2).replace('.', ',')

function PlayerCell({ id, players }: { id: string; players: Players }) {
  const p = players.get(id)
  const name = p ? fullName(p) : '—'
  return (
    <Link to={`/players/${id}`} className="team-cell">
      <Avatar src={p?.photo_url} name={name} size={26} />
      <span className="team-cell-name">{name}</span>
    </Link>
  )
}

/** Рейтинг серии: 3 очка за 1-е место команды игрока, 2 — за 2-е, 1 — за 3-е. */
export function PointsLeaderboard({ rows, players }: { rows: SeriesPointsRow[]; players: Players }) {
  const [sort, setSort] = useState<'total' | 'avg'>('total')

  const sorted = useMemo(() => {
    const list = rows.filter((r) => r.tournaments > 0)
    return sort === 'total'
      ? list.sort((a, b) => b.points - a.points || avg(b.points, b.tournaments) - avg(a.points, a.tournaments) || b.first - a.first)
      : list.sort((a, b) => avg(b.points, b.tournaments) - avg(a.points, a.tournaments) || b.tournaments - a.tournaments || b.points - a.points)
  }, [rows, sort])

  if (sorted.length === 0) return <div className="card state">Очки появятся, когда в серии будет хотя бы один завершённый турнир</div>

  return (
    <>
      <div className="toolbar">
        <Segmented<'total' | 'avg'>
          value={sort}
          onChange={setSort}
          options={[
            { value: 'total', label: 'Всего очков' },
            { value: 'avg', label: 'В среднем за турнир' },
          ]}
        />
      </div>
      <div className="card table-wrap">
        <table className="standings players-table">
          <thead>
            <tr>
              <th>#</th>
              <th className="left">Игрок</th>
              <th>Т</th>
              <th>🥇</th>
              <th>🥈</th>
              <th>🥉</th>
              <th>О</th>
              <th>Ср</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r, i) => (
              <tr key={r.player_id}>
                <td>
                  <span className={`place ${i === 0 ? 'place-1' : ''}`}>{i + 1}</span>
                </td>
                <td className="left">
                  <PlayerCell id={r.player_id} players={players} />
                </td>
                <td>{r.tournaments}</td>
                <td>{r.first || ''}</td>
                <td>{r.second || ''}</td>
                <td>{r.third || ''}</td>
                <td className={sort === 'total' ? 'pts' : ''}>{r.points}</td>
                <td className={`nowrap ${sort === 'avg' ? 'pts' : ''}`}>{fmt(avg(r.points, r.tournaments))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">
        За место команды в турнире: 1-е — 3 очка, 2-е — 2, 3-е — 1. Учитываются завершённые турниры. Т — турниров сыграно, Ср — очков в среднем за турнир.
      </p>
    </>
  )
}

type Metric = 'goals' | 'assists' | 'ga'
const value = (s: StatsRow, m: Metric) => (m === 'goals' ? s.goals : m === 'assists' ? s.assists : s.goals + s.assists)

/** Лидеры по метрике; при равенстве — меньше матчей выше. Возвращает всех, кто делит первое место. */
function leaders(stats: StatsRow[], m: Metric): StatsRow[] {
  const best = Math.max(0, ...stats.map((s) => value(s, m)))
  if (best === 0) return []
  return stats.filter((s) => value(s, m) === best).sort((a, b) => a.matches - b.matches)
}

function LeaderCard({ icon, title, list, metric, players }: { icon: string; title: string; list: StatsRow[]; metric: Metric; players: Players }) {
  const top = list[0]
  const p = top ? players.get(top.player_id) : undefined
  return (
    <div className="leader card">
      <div className="leader-title">
        {icon} {title}
      </div>
      {top && p ? (
        <Link to={`/players/${top.player_id}`} className="leader-body">
          <Avatar src={p.photo_url} name={fullName(p)} size={44} />
          <div className="leader-main">
            <div className="leader-name">{fullName(p)}</div>
            <div className="muted small">
              {list.length > 1 ? `и ещё ${list.length - 1} с тем же результатом · ` : ''}
              {fmt(avg(value(top, metric), top.matches))} за матч
            </div>
          </div>
          <div className="leader-value">{value(top, metric)}</div>
        </Link>
      ) : (
        <div className="muted small">Пока никого</div>
      )}
    </div>
  )
}

/** Бомбардиры и ассистенты серии: всего и в среднем за сыгранный матч. */
export function ScorersLeaderboard({ stats, players }: { stats: StatsRow[]; players: Players }) {
  const [metric, setMetric] = useState<Metric>('goals')
  const [mode, setMode] = useState<'total' | 'avg'>('total')

  const shown = (s: StatsRow, m: Metric) => (mode === 'total' ? String(value(s, m)) : fmt(avg(value(s, m), s.matches)))

  const sorted = useMemo(() => {
    const score = (s: StatsRow) => (mode === 'total' ? value(s, metric) : avg(value(s, metric), s.matches))
    return stats
      .filter((s) => s.matches > 0 || s.goals + s.assists > 0)
      .filter((s) => score(s) > 0)
      .sort((a, b) => score(b) - score(a) || (mode === 'total' ? a.matches - b.matches : b.matches - a.matches))
  }, [stats, metric, mode])

  return (
    <>
      <div className="leaders">
        <LeaderCard icon="⚽" title="Лучший бомбардир" list={leaders(stats, 'goals')} metric="goals" players={players} />
        <LeaderCard icon="🅰️" title="Лучший ассистент" list={leaders(stats, 'assists')} metric="assists" players={players} />
      </div>

      <div className="toolbar">
        <Segmented<Metric>
          value={metric}
          onChange={setMetric}
          options={[
            { value: 'goals', label: 'Голы' },
            { value: 'assists', label: 'Пасы' },
            { value: 'ga', label: 'Гол+пас' },
          ]}
        />
      </div>
      <div className="toolbar">
        <Segmented<'total' | 'avg'>
          value={mode}
          onChange={setMode}
          options={[
            { value: 'total', label: 'Всего' },
            { value: 'avg', label: 'За матч' },
          ]}
        />
      </div>

      {sorted.length === 0 ? (
        <div className="card state">Пока пусто — здесь появятся игроки после первых голов</div>
      ) : (
        <div className="card table-wrap">
          <table className="standings players-table">
            <thead>
              <tr>
                <th>#</th>
                <th className="left">Игрок</th>
                <th>И</th>
                <th>Г</th>
                <th>П</th>
                <th>Г+П</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((s, i) => (
                <tr key={s.player_id}>
                  <td>{i + 1}</td>
                  <td className="left">
                    <PlayerCell id={s.player_id} players={players} />
                  </td>
                  <td>{s.matches}</td>
                  <td className={`nowrap ${metric === 'goals' ? 'pts' : ''}`}>{shown(s, 'goals')}</td>
                  <td className={`nowrap ${metric === 'assists' ? 'pts' : ''}`}>{shown(s, 'assists')}</td>
                  <td className={`nowrap ${metric === 'ga' ? 'pts' : ''}`}>{shown(s, 'ga')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted small">«За матч» — среднее за сыгранные матчи серии (И). При равенстве выше тот, кто сыграл меньше матчей.</p>
    </>
  )
}
