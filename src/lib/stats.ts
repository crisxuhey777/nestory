import type { FeedRecord, GrowthRecord } from '../data/types'
import { DAY, isSameDay, startOfDay } from './date'

export type FeedKind = 'breast' | 'bottle' | 'formula'

export function feedKinds(r: FeedRecord): FeedKind[] {
  const kinds: FeedKind[] = []
  if (r.leftSec + r.rightSec > 0) kinds.push('breast')
  if (r.bottleMl > 0) kinds.push('bottle')
  if (r.formulaMl > 0) kinds.push('formula')
  return kinds
}

export function isBreast(r: FeedRecord) {
  return r.leftSec + r.rightSec > 0
}

export function sortFeeds(feeds: FeedRecord[]): FeedRecord[] {
  return [...feeds].sort((a, b) => a.startedAt - b.startedAt)
}

/** 吃奶间隔 = 本次开始时间 − 上次开始时间（以开始时间为准，跨午夜自然正确） */
export function feedIntervals(feeds: FeedRecord[]): { id: string; at: number; minutes: number }[] {
  const sorted = sortFeeds(feeds)
  const out: { id: string; at: number; minutes: number }[] = []
  for (let i = 1; i < sorted.length; i++) {
    out.push({
      id: sorted[i].id,
      at: sorted[i].startedAt,
      minutes: (sorted[i].startedAt - sorted[i - 1].startedAt) / 60000,
    })
  }
  return out
}

export type FeedStats = {
  count: number
  breastCount: number
  bottleCount: number
  formulaCount: number
  bottleMl: number
  formulaMl: number
  totalMl: number
  /** 最近一次喂奶开始时间 */
  lastAt: number | null
  last: FeedRecord | null
  /** 距上次喂奶的分钟数 */
  sinceLastMin: number
  /** 今日平均间隔（分钟），无可用数据为 null */
  avgIntervalMin: number | null
  /** 最近一次间隔（分钟） */
  lastIntervalMin: number | null
  count24h: number
  /** 今日亲喂累计秒 */
  breastSec: number
  nextReminderAt: number | null
}

export function feedStats(feeds: FeedRecord[], intervalMinutes: number, now = Date.now()): FeedStats {
  const today = feeds.filter((f) => isSameDay(f.startedAt, now))
  const sorted = sortFeeds(feeds)
  const intervals = feedIntervals(feeds)

  const todayIntervals = intervals.filter((i) => isSameDay(i.at, now)).map((i) => i.minutes)
  const avgIntervalMin = todayIntervals.length
    ? todayIntervals.reduce((a, b) => a + b, 0) / todayIntervals.length
    : null

  const last = sorted.length ? sorted[sorted.length - 1] : null
  const lastAt = last ? last.startedAt : null
  const lastInterval = intervals.length ? intervals[intervals.length - 1].minutes : null

  const sum = (fn: (f: FeedRecord) => number) => today.reduce((acc, f) => acc + fn(f), 0)

  return {
    count: today.length,
    breastCount: today.filter(isBreast).length,
    bottleCount: today.filter((f) => f.bottleMl > 0).length,
    formulaCount: today.filter((f) => f.formulaMl > 0).length,
    bottleMl: sum((f) => f.bottleMl),
    formulaMl: sum((f) => f.formulaMl),
    totalMl: sum((f) => f.bottleMl + f.formulaMl),
    lastAt,
    last,
    sinceLastMin: lastAt ? Math.max(0, (now - lastAt) / 60000) : 0,
    avgIntervalMin,
    lastIntervalMin: lastInterval,
    count24h: feeds.filter((f) => f.startedAt >= now - DAY).length,
    breastSec: sum((f) => f.leftSec + f.rightSec),
    nextReminderAt: lastAt ? lastAt + intervalMinutes * 60000 : null,
  }
}

/** 近 7 天按天的喂奶次数与毫升数，用于趋势条 */
export function last7Days(feeds: FeedRecord[], now = Date.now()) {
  const out: { day: number; count: number; ml: number; label: string }[] = []
  for (let i = 6; i >= 0; i--) {
    const day = startOfDay(now - i * DAY)
    const next = day + DAY
    const list = feeds.filter((f) => f.startedAt >= day && f.startedAt < next)
    const d = new Date(day)
    out.push({
      day,
      count: list.length,
      ml: list.reduce((a, f) => a + f.bottleMl + f.formulaMl, 0),
      label: ['日', '一', '二', '三', '四', '五', '六'][d.getDay()],
    })
  }
  return out
}

export function latestGrowth(growths: GrowthRecord[]): GrowthRecord | null {
  if (!growths.length) return null
  return [...growths].sort((a, b) => a.at - b.at)[growths.length - 1]
}

export function previousGrowth(growths: GrowthRecord[]): GrowthRecord | null {
  if (growths.length < 2) return null
  return [...growths].sort((a, b) => a.at - b.at)[growths.length - 2]
}

/** 今日睡眠累计（分钟），跨午夜的部分按重叠计算 */
export function sleepMinutesToday(sleeps: { startedAt: number; endedAt?: number }[], now = Date.now()) {
  const dayStart = startOfDay(now)
  const dayEnd = dayStart + DAY
  let total = 0
  for (const s of sleeps) {
    const end = s.endedAt ?? now
    const from = Math.max(s.startedAt, dayStart)
    const to = Math.min(end, dayEnd)
    if (to > from) total += to - from
  }
  return total / 60000
}

export function diaperCountsToday(diapers: { at: number; kind: 'wet' | 'dirty' | 'both' }[], now = Date.now()) {
  const today = diapers.filter((d) => isSameDay(d.at, now))
  return {
    wet: today.filter((d) => d.kind === 'wet' || d.kind === 'both').length,
    dirty: today.filter((d) => d.kind === 'dirty' || d.kind === 'both').length,
    total: today.length,
    lastAt: today.length ? Math.max(...today.map((d) => d.at)) : null,
  }
}
