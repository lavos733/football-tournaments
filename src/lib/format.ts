import type { Format, Player, Position, TournamentStatus } from './types'

export const POSITIONS: Record<Position, string> = {
  GK: 'Вратарь',
  DEF: 'Защитник',
  MID: 'Полузащитник',
  FWD: 'Нападающий',
}

export const POS_SHORT: Record<Position, string> = {
  GK: 'ВРТ',
  DEF: 'ЗЩ',
  MID: 'ПЗ',
  FWD: 'НАП',
}

export const STATUS_LABEL: Record<TournamentStatus, string> = {
  draft: 'Подготовка',
  active: 'Идёт',
  finished: 'Завершён',
}

/** Размер заявки: [минимум, максимум] */
export const ROSTER_LIMITS: Record<Format, [number, number]> = {
  5: [5, 10],
  8: [8, 14],
}

export const TEAM_COLORS = ['#e53935', '#1e88e5', '#43a047', '#fdd835', '#8e24aa', '#fb8c00', '#00acc1', '#212121', '#f5f5f5']

export function fullName(p: Pick<Player, 'first_name' | 'last_name'>): string {
  return [p.first_name, p.last_name].filter(Boolean).join(' ')
}

export function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few
  return many
}

export function age(birth: string | null): number | null {
  if (!birth) return null
  const b = new Date(birth)
  const now = new Date()
  let a = now.getFullYear() - b.getFullYear()
  if (now.getMonth() < b.getMonth() || (now.getMonth() === b.getMonth() && now.getDate() < b.getDate())) a--
  return a
}

export function ageLabel(birth: string | null): string | null {
  const a = age(birth)
  return a === null ? null : `${a} ${plural(a, 'год', 'года', 'лет')}`
}

export function playersCount(n: number): string {
  return `${n} ${plural(n, 'игрок', 'игрока', 'игроков')}`
}
