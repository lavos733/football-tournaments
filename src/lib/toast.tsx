import { useEffect, useState } from 'react'
import { errText } from './supabase'
import { haptic } from './telegram'

type Toast = { id: number; text: string; kind: 'ok' | 'error' }
type Listener = (t: Toast) => void

const listeners = new Set<Listener>()
let seq = 0

export function toast(text: string) {
  const t: Toast = { id: ++seq, text, kind: 'ok' }
  listeners.forEach((l) => l(t))
}

export function toastError(e: unknown) {
  haptic('error')
  const t: Toast = { id: ++seq, text: errText(e), kind: 'error' }
  listeners.forEach((l) => l(t))
}

export function Toaster() {
  const [items, setItems] = useState<Toast[]>([])
  useEffect(() => {
    const l: Listener = (t) => {
      setItems((s) => [...s, t])
      setTimeout(() => setItems((s) => s.filter((x) => x.id !== t.id)), 3500)
    }
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  }, [])
  return (
    <div className="toaster">
      {items.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`}>
          {t.text}
        </div>
      ))}
    </div>
  )
}
