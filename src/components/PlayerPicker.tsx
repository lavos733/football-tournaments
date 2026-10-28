import { useMemo, useState } from 'react'
import { useQuery } from '../lib/hooks'
import { q, supabase } from '../lib/supabase'
import { POS_SHORT, ageLabel, fullName } from '../lib/format'
import type { Player } from '../lib/types'
import { PlayerForm } from './PlayerForm'
import { Avatar, ErrorBox, Loading, Sheet } from './ui'

/**
 * Выбор игрока из общей базы.
 * disabled: { [playerId]: причина } — такие игроки показываются, но выбрать их нельзя.
 */
export function PlayerPicker({
  open,
  title = 'Добавить игрока',
  disabled = {},
  onClose,
  onPick,
}: {
  open: boolean
  title?: string
  disabled?: Record<string, string>
  onClose(): void
  onPick(p: Player): void
}) {
  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState(false)
  const { data, loading, error, reload } = useQuery(
    () => (open ? q(supabase.from('players').select('*').order('last_name').order('first_name').limit(1000)) : Promise.resolve([])),
    [open],
  )

  const list = useMemo(() => {
    const s = search.trim().toLowerCase()
    const all = (data as Player[] | undefined) ?? []
    return s ? all.filter((p) => fullName(p).toLowerCase().includes(s)) : all
  }, [data, search])

  return (
    <>
      <Sheet open={open && !creating} title={title} onClose={onClose}>
        <div className="picker-search">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Поиск по имени" autoFocus />
        </div>
        <button className="btn btn-secondary btn-block" onClick={() => setCreating(true)}>
          + Новый игрок
        </button>
        {loading ? (
          <Loading />
        ) : error ? (
          <ErrorBox text={error} onRetry={reload} />
        ) : (
          <div className="list">
            {list.map((p) => {
              const reason = disabled[p.id]
              return (
                <button key={p.id} className="row" disabled={Boolean(reason)} onClick={() => onPick(p)}>
                  <Avatar src={p.photo_url} name={fullName(p)} size={36} />
                  <div className="row-main">
                    <div className="row-title">{fullName(p)}</div>
                    <div className="row-sub">{reason ?? [p.position && POS_SHORT[p.position], ageLabel(p.birth_date)].filter(Boolean).join(' · ')}</div>
                  </div>
                </button>
              )
            })}
            {list.length === 0 && <div className="state">Никого не нашли</div>}
          </div>
        )}
      </Sheet>
      <PlayerForm
        open={open && creating}
        onClose={() => setCreating(false)}
        onSaved={(p) => {
          setCreating(false)
          reload()
          onPick(p)
        }}
      />
    </>
  )
}
