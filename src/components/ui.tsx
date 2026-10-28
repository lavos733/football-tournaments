import { useEffect, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { inTelegram, tg } from '../lib/telegram'
import { TEAM_COLORS } from '../lib/format'

/** Экран: шапка (заголовок, «назад», действия) + содержимое. */
export function Page({ title, back, actions, children }: { title: string; back?: string; actions?: ReactNode; children: ReactNode }) {
  const nav = useNavigate()

  useEffect(() => {
    if (!back || !inTelegram || !tg) return
    const go = () => nav(back)
    tg.BackButton.show()
    tg.BackButton.onClick(go)
    return () => {
      tg!.BackButton.offClick(go)
      tg!.BackButton.hide()
    }
  }, [back, nav])

  return (
    <>
      <header className="topbar">
        {back && !inTelegram && (
          <button className="topbar-back" onClick={() => nav(back)} aria-label="Назад">
            ‹
          </button>
        )}
        <h1>{title}</h1>
        <div className="topbar-actions">{actions}</div>
      </header>
      <main className="content">{children}</main>
    </>
  )
}

/** Нижняя «шторка» для форм и выбора. */
export function Sheet({ open, title, onClose, children }: { open: boolean; title: string; onClose(): void; children: ReactNode }) {
  useEffect(() => {
    if (!open) return
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = ''
    }
  }, [open])
  if (!open) return null
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Закрыть">
            ✕
          </button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  )
}

export function Avatar({ src, name, size = 40, color }: { src?: string | null; name: string; size?: number; color?: string }) {
  const initials = name
    .split(' ')
    .map((w) => w.match(/\p{L}/u)?.[0])
    .filter(Boolean)
    .slice(0, 2)
    .map((c) => c!.toUpperCase())
    .join('')
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.38, background: src ? undefined : color }}>
      {src ? <img src={src} alt="" /> : initials || '?'}
    </span>
  )
}

export function TeamBadge({ color, size = 14 }: { color: string; size?: number }) {
  return <span className="team-badge" style={{ background: color, width: size, height: size }} />
}

export function Loading() {
  return <div className="state">Загрузка…</div>
}

export function ErrorBox({ text, onRetry }: { text: string; onRetry?(): void }) {
  return (
    <div className="state state-error">
      <p>{text}</p>
      {onRetry && (
        <button className="btn btn-secondary" onClick={onRetry}>
          Повторить
        </button>
      )}
    </div>
  )
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="state">
      <p className="state-title">{title}</p>
      {children}
    </div>
  )
}

export function Section({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="section">
      <div className="section-head">
        <span>{title}</span>
        {right}
      </div>
      {children}
    </section>
  )
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange(v: T): void
}) {
  return (
    <div className="segmented">
      {options.map((o) => (
        <button key={String(o.value)} type="button" className={o.value === value ? 'active' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function ColorPicker({ value, onChange }: { value: string; onChange(c: string): void }) {
  return (
    <div className="colors">
      {TEAM_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          className={`color-dot ${c === value ? 'active' : ''}`}
          style={{ background: c }}
          onClick={() => onChange(c)}
          aria-label={c}
        />
      ))}
    </div>
  )
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  )
}
