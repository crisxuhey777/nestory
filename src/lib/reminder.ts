/**
 * 喂养提醒的纯计算部分：什么时候该提醒、夜间安静时段、去重键。
 * 这里不碰浏览器 API，方便单测；真正的通知发送在 lib/notify.ts。
 */
import type { FeedRecord, Reminder } from '../data/types'
import { minutesLabel } from './date'

/** 22:00 起、07:00 前算夜间（本地时区）。 */
export const QUIET_START_HOUR = 22
export const QUIET_END_HOUR = 7

export function isQuietHour(at: number): boolean {
  const hour = new Date(at).getHours()
  return hour >= QUIET_START_HOUR || hour < QUIET_END_HOUR
}

/** 最近一次喂奶（以开始时间为准）。 */
export function latestFeed(feeds: FeedRecord[]): FeedRecord | null {
  let last: FeedRecord | null = null
  for (const feed of feeds) {
    if (!last || feed.startedAt > last.startedAt) last = feed
  }
  return last
}

export type DueReminder = {
  /** 触发这次提醒的那条喂养记录 */
  feedId: string
  /** 应该提醒的时刻 = 上次开始时间 + 间隔 */
  dueAt: number
  /** 已经过了多少分钟 */
  lateMinutes: number
  /** 去重键：换了喂养记录或改了间隔才会重新提醒 */
  key: string
}

export function reminderKey(feedId: string, dueAt: number): string {
  return `${feedId}@${dueAt}`
}

/**
 * 现在是否该提醒。
 * - 提醒关闭、没有喂养记录、还没到时间 → null
 * - 夜间安静时段（开启时）→ null，但不会写去重键，等天亮后仍然会提醒一次
 */
export function dueReminder(
  feeds: FeedRecord[],
  reminder: Reminder,
  now: number = Date.now(),
  quiet: boolean = reminder.quietNight && isQuietHour(now),
): DueReminder | null {
  if (!reminder.enabled) return null
  const last = latestFeed(feeds)
  if (!last) return null
  const dueAt = last.startedAt + reminder.intervalMinutes * 60_000
  if (now < dueAt) return null
  if (quiet) return null
  return {
    feedId: last.id,
    dueAt,
    lateMinutes: Math.floor((now - dueAt) / 60_000),
    key: reminderKey(last.id, dueAt),
  }
}

/** 提醒正文：距上次喂奶多久。 */
export function reminderBody(minutesSinceLast: number): string {
  return `距上次喂奶已经 ${minutesLabel(minutesSinceLast)}，看看宝宝是不是有点饿了。`
}

/** 距上次喂奶的分钟数（按上次开始时间算）。 */
export function minutesSinceLastFeed(feeds: FeedRecord[], now: number = Date.now()): number | null {
  const last = latestFeed(feeds)
  if (!last) return null
  return Math.max(0, Math.round((now - last.startedAt) / 60_000))
}
