/**
 * 纯逻辑回归测试：真实日历月龄、跨午夜喂养间隔、统计汇总、纪念日。
 * 运行：npm test
 */
import { expect, test } from 'vitest'
import { addMonths, ageBetween, ageLabel, daysUntilAnniversary, durationLabel, shortSpan } from '../src/lib/date'
import { feedIntervals, feedStats, last7Days, latestGrowth, sleepMinutesToday } from '../src/lib/stats'
import type { FeedRecord, SleepRecord } from '../src/data/types'

let pass = 0
const failures: string[] = []

function ok(name: string, cond: boolean, extra = '') {
  if (cond) {
    pass += 1
  } else {
    failures.push(`${name}${extra ? ` — ${extra}` : ''}`)
  }
}

function eq(name: string, actual: unknown, expected: unknown) {
  ok(name, Object.is(actual, expected), `期望 ${String(expected)}，实际 ${String(actual)}`)
}

function feed(partial: Partial<FeedRecord> & { id: string; startedAt: number }): FeedRecord {
  return {
    leftSec: 0,
    rightSec: 0,
    bottleMl: 0,
    formulaMl: 0,
    author: '妈妈',
    updatedAt: partial.startedAt,
    ...partial,
  }
}

// ---------- 真实日历月龄 ----------
test('真实日历月龄', () => {
  const age = ageBetween(new Date(2026, 6, 31, 6, 20), new Date(2026, 10, 11, 22, 0))
  eq('月龄：7/31 → 11/11 为 3 个月', age.months, 3)
  eq('月龄：余 11 天', age.days, 11)
  eq('月龄：总天数 103 天', age.totalDays, 103)
  eq('月龄文案', ageLabel(age), '3 个月 11 天')

  // 不能按 30 天一个月计算
  const short = ageBetween(new Date(2026, 1, 28), new Date(2026, 2, 31))
  eq('2/28 → 3/31 为 1 个月 3 天（不是 1 个月 0 天）', `${short.months}-${short.days}`, '1-3')

  // 月末 clamp：1/31 + 1 个月 = 2/28
  eq('月末 clamp', addMonths(new Date(2026, 0, 31), 1).getDate(), 28)
})

// ---------- 跨午夜喂养间隔 ----------
test('跨午夜喂养间隔', () => {
  const night = [
    feed({ id: 'a', startedAt: new Date(2026, 10, 10, 23, 20).getTime(), leftSec: 8 * 60 }),
    feed({ id: 'b', startedAt: new Date(2026, 10, 11, 1, 0).getTime(), bottleMl: 90 }),
  ]
  const intervals = feedIntervals(night)
  eq('跨午夜间隔 = 100 分钟', intervals[0].minutes, 100)
  eq('间隔文案', shortSpan(intervals[0].minutes), '1h40m')

  const stats = feedStats(night, 180, new Date(2026, 10, 11, 1, 10).getTime())
  eq('跨午夜后最近一次间隔', stats.lastIntervalMin, 100)
  eq('24 小时内两条都计入', stats.count24h, 2)
  eq('跨午夜当天只统计今天开始的 1 条', stats.count, 1)
})

// ---------- 汇总：亲喂分钟与奶量分开 ----------
test('汇总：亲喂分钟与奶量分开', () => {
  const now = new Date(2026, 10, 11, 20, 0).getTime()
  const feeds = [
    feed({ id: '1', startedAt: now - 8 * 3600_000, leftSec: 600, rightSec: 480 }),
    feed({ id: '2', startedAt: now - 5 * 3600_000, bottleMl: 120 }),
    feed({ id: '3', startedAt: now - 2 * 3600_000, formulaMl: 90, bottleMl: 30 }),
  ]
  const s = feedStats(feeds, 180, now)
  eq('次数', s.count, 3)
  eq('瓶喂母乳总量只含 bottleMl', s.bottleMl, 150)
  eq('配方奶量', s.formulaMl, 90)
  eq('总奶量 = 瓶喂 + 配方', s.totalMl, 240)
  eq('亲喂秒数不进入奶量', s.breastSec, 1080)
  eq('亲喂分钟数', Math.round(s.breastSec / 60), 18)
  eq('总奶量只由毫升字段相加（亲喂不折算）', s.totalMl, s.bottleMl + s.formulaMl)
  eq('最近一次', s.last?.id, '3')
  eq('距上次分钟', s.sinceLastMin, 120)
  eq('平均间隔 3 小时', s.avgIntervalMin, 180)
})

// ---------- 修改 / 删除后统计重算 ----------
test('修改 / 删除后统计重算', () => {
  const now = new Date(2026, 10, 11, 12, 0).getTime()
  const base = [
    feed({ id: 'a', startedAt: now - 6 * 3600_000, bottleMl: 100 }),
    feed({ id: 'b', startedAt: now - 3 * 3600_000, bottleMl: 120 }),
  ]
  const before = feedStats(base, 180, now)
  // 编辑 b：把 120ml 改成 80ml
  const edited = base.map((f) => (f.id === 'b' ? { ...f, bottleMl: 80 } : f))
  const afterEdit = feedStats(edited, 180, now)
  eq('编辑后奶量重算', before.totalMl - afterEdit.totalMl, 40)
  // 删除 a
  const afterDelete = feedStats(base.filter((f) => f.id !== 'a'), 180, now)
  eq('删除后次数', afterDelete.count, 1)
  eq('删除后最近一次仍为 b', afterDelete.last?.id, 'b')
  eq('删除后平均间隔无效（只剩一次）', afterDelete.avgIntervalMin, null)
})

// ---------- 近 7 天与睡眠 ----------
test('近 7 天与睡眠', () => {
  const now = new Date(2026, 10, 11, 22, 0).getTime()
  const feeds = [
    feed({ id: 'today', startedAt: now - 3600_000, bottleMl: 90 }),
    feed({ id: 'yesterday', startedAt: now - 26 * 3600_000, bottleMl: 120 }),
    feed({ id: 'week', startedAt: now - 6 * 86400_000, bottleMl: 60 }),
  ]
  const week = last7Days(feeds, now)
  eq('近 7 天长度', week.length, 7)
  eq('近 7 天总次数', week.reduce((a, b) => a + b.count, 0), 3)
  eq('今天在最后一列', week[6].count, 1)

  const sleeps: SleepRecord[] = [
    { id: 's1', startedAt: new Date(2026, 10, 11, 0, 30).getTime(), endedAt: new Date(2026, 10, 11, 6, 30).getTime() },
    { id: 's2', startedAt: new Date(2026, 10, 11, 21, 0).getTime(), endedAt: new Date(2026, 10, 11, 23, 30).getTime() },
  ]
  const minutes = sleepMinutesToday(sleeps, new Date(2026, 10, 11, 23, 45).getTime())
  eq('今日睡眠分钟数（跨日裁剪）', minutes, 360 + 150)
  eq('时长文案', durationLabel(150 * 60), '2 小时 30 分')
})

// ---------- 生长与纪念日 ----------
test('生长与纪念日', () => {
  const now = new Date(2026, 10, 11).getTime()
  const rows = [
    { id: 'g1', at: now - 40 * 86400_000, weightKg: 4.1, heightCm: 54, headCm: 36.5 },
    { id: 'g2', at: now - 5 * 86400_000, weightKg: 5.6, heightCm: 60.5, headCm: 39.5 },
  ]
  eq('最新体重', latestGrowth(rows)?.weightKg, 5.6)

  const half = daysUntilAnniversary('2026-07-31', new Date(2026, 10, 11))
  ok('半年纪念日已计算', half !== null, '返回 null')
  if (half) {
    eq('距离半岁 81 天', half.days, 81)
    eq('纪念日名称', half.label, '半岁纪念')
  }
})

// ---------- 汇总 ----------
test('Nestory 核心业务规则（月龄 / 跨午夜间隔 / 统计重算 / 纪念日）', () => {
  expect(failures, failures.join('\n')).toEqual([])
  expect(pass).toBeGreaterThanOrEqual(30)
})
