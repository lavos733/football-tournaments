import { useEffect, useState, type FormEvent } from 'react'
import { ROSTER_LIMITS } from '../lib/format'
import type { Format, Tournament } from '../lib/types'
import { Field, Segmented, Sheet } from './ui'

export type TournamentValues = { name: string; format: Format; rounds: number }

export function TournamentForm({
  open,
  tournament,
  onClose,
  onSubmit,
}: {
  open: boolean
  tournament?: Tournament
  onClose(): void
  onSubmit(v: TournamentValues): Promise<void>
}) {
  const [name, setName] = useState('')
  const [format, setFormat] = useState<Format>(5)
  const [rounds, setRounds] = useState(1)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setName(tournament?.name ?? '')
    setFormat(tournament?.format ?? 5)
    setRounds(tournament?.rounds ?? 1)
  }, [open, tournament])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    try {
      await onSubmit({ name: name.trim(), format, rounds })
    } finally {
      setBusy(false)
    }
  }

  const [min, max] = ROSTER_LIMITS[format]

  return (
    <Sheet open={open} title={tournament ? 'Настройки турнира' : 'Новый турнир'} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <Field label="Название">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Например, «Кубок выходного дня»" required autoFocus />
        </Field>
        <Field label="Формат" hint={`В заявке команды от ${min} до ${max} игроков`}>
          <Segmented<Format>
            value={format}
            onChange={setFormat}
            options={[
              { value: 5, label: '5 × 5' },
              { value: 8, label: '8 × 8' },
            ]}
          />
        </Field>
        <Field label="Сколько кругов" hint="Каждый с каждым играет столько раз, сколько кругов">
          <Segmented<number>
            value={rounds}
            onChange={setRounds}
            options={[1, 2, 3, 4].map((n) => ({ value: n, label: String(n) }))}
          />
        </Field>
        <button className="btn btn-primary btn-block" disabled={busy || !name.trim()}>
          {busy ? 'Сохраняю…' : tournament ? 'Сохранить' : 'Создать турнир'}
        </button>
      </form>
    </Sheet>
  )
}
