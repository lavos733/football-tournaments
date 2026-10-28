import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { PlayerForm } from '../components/PlayerForm'
import { Avatar, Empty, ErrorBox, Loading, Page } from '../components/ui'
import { POS_SHORT, ageLabel, fullName } from '../lib/format'
import { useQuery } from '../lib/hooks'
import { q, supabase } from '../lib/supabase'
import type { Player } from '../lib/types'

export default function PlayersPage() {
  const nav = useNavigate()
  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState(false)
  const { data, loading, error, reload } = useQuery(
    () => q(supabase.from('players').select('*').order('last_name').order('first_name').limit(1000)),
    [],
  )

  const list = useMemo(() => {
    const s = search.trim().toLowerCase()
    const all = (data as Player[] | undefined) ?? []
    return s ? all.filter((p) => fullName(p).toLowerCase().includes(s)) : all
  }, [data, search])

  return (
    <Page
      title="Игроки"
      actions={
        <button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>
          + Игрок
        </button>
      }
    >
      <div className="search">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Поиск по имени" />
      </div>
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorBox text={error} onRetry={reload} />
      ) : list.length === 0 ? (
        <Empty title={search ? 'Никого не нашли' : 'В базе пока нет игроков'}>
          <button className="btn btn-primary" onClick={() => setCreating(true)}>
            Добавить игрока
          </button>
        </Empty>
      ) : (
        <div className="list card">
          {list.map((p) => (
            <Link key={p.id} to={`/players/${p.id}`} className="row">
              <Avatar src={p.photo_url} name={fullName(p)} size={40} />
              <div className="row-main">
                <div className="row-title">
                  {fullName(p)} {p.linked_profile_id && <span className="verified" title="Подтверждённый профиль">✓</span>}
                </div>
                <div className="row-sub">{[p.position && POS_SHORT[p.position], ageLabel(p.birth_date)].filter(Boolean).join(' · ') || '—'}</div>
              </div>
              <span className="chevron">›</span>
            </Link>
          ))}
        </div>
      )}
      <PlayerForm open={creating} onClose={() => setCreating(false)} onSaved={(p) => nav(`/players/${p.id}`)} />
    </Page>
  )
}
