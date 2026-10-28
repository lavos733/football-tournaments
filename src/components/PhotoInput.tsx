import { useRef, useState } from 'react'
import { useAuth } from '../lib/auth'
import { uploadPhoto } from '../lib/supabase'
import { toastError } from '../lib/toast'
import { Avatar } from './ui'

export function PhotoInput({ value, name, onChange }: { value: string | null; name: string; onChange(url: string | null): void }) {
  const { userId } = useAuth()
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  async function pick(file: File | undefined) {
    if (!file || !userId) return
    setBusy(true)
    try {
      onChange(await uploadPhoto(file, userId))
    } catch (e) {
      toastError(e)
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }

  return (
    <div className="photo-input">
      <Avatar src={value} name={name || '?'} size={72} color="var(--muted-bg)" />
      <div className="photo-input-actions">
        <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? 'Загрузка…' : value ? 'Заменить фото' : 'Загрузить фото'}
        </button>
        {value && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange(null)}>
            Убрать
          </button>
        )}
      </div>
      <input ref={input} type="file" accept="image/*" hidden onChange={(e) => pick(e.target.files?.[0])} />
    </div>
  )
}
