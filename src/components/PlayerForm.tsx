import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { q, supabase } from '../lib/supabase'
import { toastError } from '../lib/toast'
import { POSITIONS, ageLabel, fullName } from '../lib/format'
import type { Player, Position } from '../lib/types'
import { PhotoInput } from './PhotoInput'
import { Avatar, Field, Sheet } from './ui'

/** Создание / редактирование игрока. Пока вводится имя — подсказывает похожих, чтобы не плодить дубли. */
export function PlayerForm({
  open,
  player,
  onClose,
  onSaved,
}: {
  open: boolean
  player?: Player
  onClose(): void
  onSaved(p: Player): void
}) {
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [position, setPosition] = useState<Position | null>(null)
  const [birthDate, setBirthDate] = useState('')
  const [photo, setPhoto] = useState<string | null>(null)
  const [similar, setSimilar] = useState<Player[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setFirstName(player?.first_name ?? '')
    setLastName(player?.last_name ?? '')
    setPosition(player?.position ?? null)
    setBirthDate(player?.birth_date ?? '')
    setPhoto(player?.photo_url ?? null)
    setSimilar([])
  }, [open, player])

  // поиск похожих игроков (только при создании)
  useEffect(() => {
    if (player || !open) return
    const last = lastName.trim()
    const first = firstName.trim()
    if (last.length < 2 && first.length < 2) {
      setSimilar([])
      return
    }
    const timer = setTimeout(async () => {
      let req = supabase.from('players').select('*').limit(5)
      if (last.length >= 2) req = req.ilike('last_name', `${last}%`)
      if (first.length >= 2) req = req.ilike('first_name', `${first}%`)
      const { data } = await req
      setSimilar((data as Player[]) ?? [])
    }, 300)
    return () => clearTimeout(timer)
  }, [firstName, lastName, player, open])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!firstName.trim()) return
    setBusy(true)
    const values = {
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      position,
      birth_date: birthDate || null,
      photo_url: photo,
    }
    try {
      const saved = player
        ? await q(supabase.from('players').update(values).eq('id', player.id).select().single())
        : await q(supabase.from('players').insert(values).select().single())
      onSaved(saved as Player)
    } catch (err) {
      toastError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open={open} title={player ? 'Редактировать игрока' : 'Новый игрок'} onClose={onClose}>
      <form onSubmit={submit} className="form">
        <PhotoInput value={photo} name={`${firstName} ${lastName}`} onChange={setPhoto} />
        <Field label="Имя">
          <input value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Иван" required autoFocus />
        </Field>
        <Field label="Фамилия">
          <input value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Петров" />
        </Field>

        {similar.length > 0 && (
          <div className="similar">
            <div className="similar-title">Похожие игроки уже есть в базе:</div>
            {similar.map((p) => (
              <Link key={p.id} to={`/players/${p.id}`} className="similar-row" onClick={onClose}>
                <Avatar src={p.photo_url} name={fullName(p)} size={28} />
                <span>{fullName(p)}</span>
                <span className="muted">{ageLabel(p.birth_date) ?? ''}</span>
              </Link>
            ))}
          </div>
        )}

        <Field label="Позиция">
          <div className="chips">
            {(Object.keys(POSITIONS) as Position[]).map((k) => (
              <button key={k} type="button" className={`chip ${position === k ? 'active' : ''}`} onClick={() => setPosition(position === k ? null : k)}>
                {POSITIONS[k]}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Дата рождения">
          <input type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} max={new Date().toISOString().slice(0, 10)} />
        </Field>
        <button className="btn btn-primary btn-block" disabled={busy || !firstName.trim()}>
          {busy ? 'Сохраняю…' : player ? 'Сохранить' : 'Создать игрока'}
        </button>
      </form>
    </Sheet>
  )
}
