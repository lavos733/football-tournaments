import { useMemo, useState } from 'react'
import { useQuery } from '../lib/hooks'
import { q, supabase } from '../lib/supabase'
import { toastError } from '../lib/toast'
import type { Profile } from '../lib/types'
import { Loading, Section, Sheet } from './ui'

export type JudgeRow = { profile_id: string; profile: { display_name: string; username: string | null } | null }

/** Помощники-судьи: могут вести матчи (счёт, события), но не менять сам турнир. */
export function JudgesSection({
  tournamentId,
  ownerId,
  judges,
  isOwner,
  onChange,
}: {
  tournamentId: string
  ownerId: string
  judges: JudgeRow[]
  isOwner: boolean
  onChange(): void
}) {
  const [picking, setPicking] = useState(false)
  const [search, setSearch] = useState('')
  const { data, loading } = useQuery(
    () => (picking ? q(supabase.from('profiles').select('*').order('display_name').limit(500)) : Promise.resolve([])),
    [picking],
  )

  const taken = new Set([ownerId, ...judges.map((j) => j.profile_id)])
  const candidates = useMemo(() => {
    const s = search.trim().toLowerCase()
    return ((data as Profile[] | undefined) ?? []).filter(
      (p) => !taken.has(p.id) && (!s || p.display_name.toLowerCase().includes(s) || p.username?.toLowerCase().includes(s)),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, search, judges])

  async function add(p: Profile) {
    try {
      await q(supabase.from('tournament_judges').insert({ tournament_id: tournamentId, profile_id: p.id }))
      setPicking(false)
      onChange()
    } catch (e) {
      toastError(e)
    }
  }

  async function remove(profileId: string) {
    try {
      await q(supabase.from('tournament_judges').delete().eq('tournament_id', tournamentId).eq('profile_id', profileId))
      onChange()
    } catch (e) {
      toastError(e)
    }
  }

  if (!isOwner && judges.length === 0) return null

  return (
    <Section
      title="Судьи"
      right={
        isOwner && (
          <button className="btn btn-ghost btn-sm" onClick={() => setPicking(true)}>
            + Судья
          </button>
        )
      }
    >
      {judges.length === 0 ? (
        <div className="card state">Судьи могут вводить счёт и события матчей вместо вас.</div>
      ) : (
        <div className="list card">
          {judges.map((j) => (
            <div key={j.profile_id} className="row">
              <div className="row-main">
                <div className="row-title">{j.profile?.display_name ?? 'Пользователь'}</div>
                {j.profile?.username && <div className="row-sub">@{j.profile.username}</div>}
              </div>
              {isOwner && (
                <button className="icon-btn" onClick={() => remove(j.profile_id)} aria-label="Убрать судью">
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <Sheet open={picking} title="Назначить судью" onClose={() => setPicking(false)}>
        <div className="picker-search">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Поиск по имени" autoFocus />
        </div>
        {loading ? (
          <Loading />
        ) : candidates.length === 0 ? (
          <div className="state">Никого не нашли. Судья должен хотя бы раз открыть приложение.</div>
        ) : (
          <div className="list">
            {candidates.map((p) => (
              <button key={p.id} className="row" onClick={() => add(p)}>
                <div className="row-main">
                  <div className="row-title">{p.display_name}</div>
                  {p.username && <div className="row-sub">@{p.username}</div>}
                </div>
              </button>
            ))}
          </div>
        )}
      </Sheet>
    </Section>
  )
}
