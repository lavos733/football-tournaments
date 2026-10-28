import { useEffect, useState, type FormEvent } from 'react'
import { TEAM_COLORS } from '../lib/format'
import { ColorPicker, Field, Sheet } from './ui'

/** Название + цвет. Используется и для команд базы, и для команд турнира. */
export function TeamForm({
  open,
  title,
  initial,
  submitLabel,
  onClose,
  onSubmit,
}: {
  open: boolean
  title: string
  initial?: { name: string; color: string }
  submitLabel: string
  onClose(): void
  onSubmit(v: { name: string; color: string }): Promise<void>
}) {
  const [name, setName] = useState('')
  const [color, setColor] = useState(TEAM_COLORS[0]!)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setName(initial?.name ?? '')
    setColor(initial?.color ?? TEAM_COLORS[Math.floor(Math.random() * TEAM_COLORS.length)]!)
  }, [open, initial])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    try {
      await onSubmit({ name: name.trim(), color })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open={open} title={title} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <Field label="Название">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Например, «Красные»" required autoFocus />
        </Field>
        <Field label="Цвет формы">
          <ColorPicker value={color} onChange={setColor} />
        </Field>
        <button className="btn btn-primary btn-block" disabled={busy || !name.trim()}>
          {busy ? 'Сохраняю…' : submitLabel}
        </button>
      </form>
    </Sheet>
  )
}
