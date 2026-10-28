interface TgUser {
  id: number
  first_name: string
  last_name?: string
  username?: string
}

interface TgWebApp {
  initData: string
  setHeaderColor?(color: string): void
  setBackgroundColor?(color: string): void
  initDataUnsafe?: { user?: TgUser }
  colorScheme?: 'light' | 'dark'
  ready(): void
  expand(): void
  showConfirm?(message: string, cb: (ok: boolean) => void): void
  BackButton: { show(): void; hide(): void; onClick(cb: () => void): void; offClick(cb: () => void): void }
  HapticFeedback?: { notificationOccurred(type: 'success' | 'error' | 'warning'): void }
}

export const tg: TgWebApp | undefined = (window as unknown as { Telegram?: { WebApp?: TgWebApp } }).Telegram?.WebApp

/** true — открыто внутри Telegram, false — в обычном браузере */
export const inTelegram = Boolean(tg?.initData)

export function initTelegram() {
  if (!inTelegram || !tg) return
  tg.ready()
  tg.expand()
  if (tg.colorScheme) document.documentElement.dataset.theme = tg.colorScheme
  // шапка Telegram в цвет нашей тёмной шапки
  tg.setHeaderColor?.(tg.colorScheme === 'dark' ? '#00141b' : '#001e28')
}

export function tgUserName(): string {
  const u = tg?.initDataUnsafe?.user
  return u ? [u.first_name, u.last_name].filter(Boolean).join(' ') : ''
}

export function confirmAction(message: string): Promise<boolean> {
  if (inTelegram && tg?.showConfirm) return new Promise((resolve) => tg!.showConfirm!(message, resolve))
  return Promise.resolve(window.confirm(message))
}

export function haptic(type: 'success' | 'error' | 'warning') {
  tg?.HapticFeedback?.notificationOccurred(type)
}
