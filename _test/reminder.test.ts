/**
 * 提醒逻辑回归测试：夜间安静时段、到点判断、去重键、提醒文案。
 * 运行：npm test
 */
import { expect, test } from 'vitest'
import { dueReminder, isQuietHour, latestFeed, minutesSinceLastFeed, reminderBody, reminderKey } from '../src/lib/reminder'
import type { FeedRecord, Reminder } from '../src/data/types'

let pass = 0
const failures: string[] = []

function ok(name: string, cond: boolean, extra = '') {
  if (cond) pass += 1
  else failures.push(`${name}${extra ? ` — ${extra}` : ''}`)
}

function eq(name: string, actual: unknown, expected: unknown) {
  ok(name, Object.is(actual, expected), `期望 ${String(expected)}，实际 ${String(actual)}`)
}

function at(hour: number, minute = 0) {
  return new Date(2026, 10, 13, hour, minute).getTime()
}

function feed(id: string, startedAt: number): FeedRecord {
  return {
    id,
    startedAt,
    leftSec: 0,
    rightSec: 0,
    bottleMl: 0,
    formulaMl: 0,
    author: '妈妈',
    updatedAt: startedAt,
  }
}

const reminder = (patch: Partial<Reminder> = {}): Reminder => ({
  enabled: true,
  intervalMinutes: 180,
  quietNight: true,
  vibration: false,
  ...patch,
})

// ---------- 夜间安静时段 ----------
test('夜间安静时段', () => {
  eq('21:59 还算白天', isQuietHour(at(21, 59)), false)
  eq('22:00 进入夜间', isQuietHour(at(22, 0)), true)
  eq('23:30 是夜间', isQuietHour(at(23, 30)), true)
  eq('00:00 是夜间', isQuietHour(at(0, 0)), true)
  eq('06:59 还是夜间', isQuietHour(at(6, 59)), true)
  eq('07:00 天亮', isQuietHour(at(7, 0)), false)
  eq('中午不是夜间', isQuietHour(at(12, 0)), false)
})

// ---------- 到点判断 ----------
test('到点判断与去重键', () => {
  const lastFeed = feed('f1', at(8, 0))
  const feeds = [lastFeed]

  eq('关闭提醒时不触发', dueReminder(feeds, reminder({ enabled: false }), at(12, 0)), null)
  eq('没有喂养记录不触发', dueReminder([], reminder(), at(12, 0)), null)
  eq('还没到间隔不触发', dueReminder(feeds, reminder(), at(10, 0)), null)

  const due = dueReminder(feeds, reminder(), at(11, 30))
  ok('过了 3 小时触发', due !== null)
  if (due) {
    eq('触发记录', due.feedId, 'f1')
    eq('到点时间', due.dueAt, at(11, 0))
    eq('超时分钟数', due.lateMinutes, 30)
    eq('去重键', due.key, reminderKey('f1', at(11, 0)))
  }
})

test('夜间不打扰，天亮后补一次', () => {
  const feeds = [feed('f1', at(18, 0))]

  eq('23:00 安静时段不触发', dueReminder(feeds, reminder(), at(23, 0)), null)
  ok('关闭安静时段后照常提醒', dueReminder(feeds, reminder({ quietNight: false }), at(23, 0)) !== null)
  ok('07:00 之后补上这一次', dueReminder(feeds, reminder(), new Date(2026, 10, 14, 7, 30).getTime()) !== null)
})

test('间隔变化会重新计算', () => {
  const feeds = [feed('f1', at(8, 0))]
  eq('4 小时间隔时 11:00 不该提醒', dueReminder(feeds, reminder({ intervalMinutes: 240 }), at(11, 0)), null)
  const due = dueReminder(feeds, reminder({ intervalMinutes: 240 }), at(12, 5))
  eq('4 小时间隔的到点时间', due?.dueAt, at(12, 0))
})

// ---------- 文案与最近一次 ----------
test('最近一次喂养与文案', () => {
  const feeds = [feed('a', at(9, 0)), feed('c', at(15, 0)), feed('b', at(12, 0))]
  eq('按开始时间取最近一条', latestFeed(feeds)?.id, 'c')
  eq('距上次喂奶分钟数', minutesSinceLastFeed(feeds, at(18, 20)), 200)
  eq('没有记录时返回 null', minutesSinceLastFeed([], at(18, 20)), null)
  eq('文案包含时长', reminderBody(200), '距上次喂奶已经 3 小时 20 分，看看宝宝是不是有点饿了。')
})

// ---------- 汇总 ----------
test('提醒逻辑（夜间时段 / 到点判断 / 去重 / 文案）', () => {
  expect(failures, failures.join('\n')).toEqual([])
  expect(pass).toBeGreaterThanOrEqual(20)
})
