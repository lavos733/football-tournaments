// Удаления после красной карточки: игрок уходит на 2 минуты матчевого времени и возвращается он же.
// Как в футзале, удаление заканчивается досрочно, если команда в меньшинстве пропустила.
import type { MatchEvent } from './types'

export const SUSPENSION_SECONDS = 120

export interface Suspension {
  event_id: string
  player_id: string | null
  team_id: string
  /** секунда матча, когда удалили */
  start: number
  /** секунда матча, когда удаление кончилось (или кончится, если не пропустят) */
  end: number
  /** закончилось досрочно — пропущенный гол */
  endedByGoal: boolean
}

/** Удаления матча по событиям; красные без тайм-кода (матч без таймера) не учитываются. */
export function suspensions(events: MatchEvent[]): Suspension[] {
  return events
    .filter((e) => e.type === 'red' && e.match_second != null)
    .map((e) => {
      const start = e.match_second!
      const full = start + SUSPENSION_SECONDS
      // гол или автогол в пользу соперника за время удаления
      const conceded = events
        .filter((g) => (g.type === 'goal' || g.type === 'own_goal') && g.team_id !== e.team_id && g.match_second != null)
        .map((g) => g.match_second!)
        .filter((sec) => sec >= start && sec < full)
        .sort((a, b) => a - b)[0]
      return {
        event_id: e.id,
        player_id: e.player_id,
        team_id: e.team_id,
        start,
        end: conceded ?? full,
        endedByGoal: conceded != null,
      }
    })
}

/** Сколько секунд прошло с начала матча по серверному таймеру; null — таймера нет */
export function elapsedSeconds(timerLeft: number | null, timerSince: string | null, clockSkew: number, matchSeconds: number): number | null {
  if (timerLeft == null) return null
  const left = timerSince ? Math.max(0, timerLeft - Math.floor((Date.now() + clockSkew - new Date(timerSince).getTime()) / 1000)) : timerLeft
  return matchSeconds - left
}
