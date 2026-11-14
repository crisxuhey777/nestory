/** Date/age helpers. All age maths follows real calendar months, never 30-day blocks. */

export const DAY = 86_400_000

export function startOfDay(d: Date | number): number {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x.getTime()
}

export function isSameDay(a: number, b: number): boolean {
  return startOfDay(a) === startOfDay(b)
}

export function addMonths(date: Date, months: number): Date {
  const d = new Date(date.getTime())
  const day = d.getDate()
  d.setDate(1)
  d.setMonth(d.getMonth() + months)
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  d.setDate(Math.min(day, lastDay))
  return d
}

export type Age = { months: number; days: number; totalDays: number; weeks: number }

/** 真实日历月龄：出生日到今天的自然月 + 余天 */
export function ageBetween(birth: Date, now: Date = new Date()): Age {
  let months = (now.getFullYear() - birth.getFullYear()) * 12 + (now.getMonth() - birth.getMonth())
  let anchor = addMonths(birth, months)
  if (anchor.getTime() > now.getTime()) {
    months -= 1
    anchor = addMonths(birth, months)
  }
  const days = Math.floor((startOfDay(now) - startOfDay(anchor)) / DAY)
  const totalDays = Math.floor((startOfDay(now) - startOfDay(birth)) / DAY)
  return { months, days, totalDays, weeks: Math.floor(totalDays / 7) }
}

export function ageLabel(age: Age): string {
  if (age.months <= 0) return `${age.totalDays} 天`
  return `${age.months} 个月 ${age.days} 天`
}

export function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

export function timeHM(ts: number): string {
  const d = new Date(ts)
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

/** 秒 → 00:12:34 */
export function clock(sec: number): string {
  const s = Math.max(0, Math.round(sec))
  return `${pad2(Math.floor(s / 3600))}:${pad2(Math.floor((s % 3600) / 60))}:${pad2(s % 60)}`
}

/** 秒 → 12 分 34 秒 / 2 小时 46 分 */
export function durationLabel(sec: number): string {
  const s = Math.max(0, Math.round(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h > 0) return `${h} 小时 ${m} 分`
  if (m > 0) return `${m} 分 ${s % 60} 秒`
  return `${s} 秒`
}

/** 分钟 → 2 小时 18 分 */
export function minutesLabel(min: number): string {
  const m = Math.max(0, Math.round(min))
  if (m < 60) return `${m} 分钟`
  const h = Math.floor(m / 60)
  const rest = m % 60
  return rest === 0 ? `${h} 小时` : `${h} 小时 ${rest} 分`
}

/** 紧凑：2h18m / 46m */
export function shortSpan(min: number): string {
  const m = Math.max(0, Math.round(min))
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h${m % 60 ? `${pad2(m % 60)}m` : ''}`
}

const WEEKDAY = ['日', '一', '二', '三', '四', '五', '六']

export function chineseDate(ts: number): string {
  const d = new Date(ts)
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日 · 周${WEEKDAY[d.getDay()]}`
}

export function longDate(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日`
}

/** 相册内用：同月分组下省略年份，如「11 月 10 日」 */
export function monthDay(ts: number): string {
  const d = new Date(ts)
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日`
}

export function shortDate(ts: number): string {
  const d = new Date(ts)
  return `${pad2(d.getMonth() + 1)}.${pad2(d.getDate())}`
}

export function monthLabel(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月`
}

/** 相对时间：刚刚 / 18 分钟前 / 2 小时前 */
export function relativeFromNow(ts: number, now = Date.now()): string {
  const diff = Math.max(0, now - ts)
  const min = Math.floor(diff / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const h = Math.floor(min / 60)
  if (h < 24) {
    const rest = min % 60
    return rest ? `${h} 小时 ${rest} 分前` : `${h} 小时前`
  }
  return `${Math.floor(h / 24)} 天前`
}

export function toISODate(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

export function fromISODate(s: string, hh = 0, mm = 0): number {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d, hh, mm, 0, 0).getTime()
}

/** 由生日推出的全部纪念日（含已过去的），时间轴与倒计时共用同一套标签。 */
export function anniversaryCandidates(birthday: string): { date: Date; label: string }[] {
  const b = new Date(fromISODate(birthday))
  return [
    { date: addMonths(b, 1), label: '满月纪念' },
    { date: new Date(b.getTime() + 100 * DAY), label: '百天纪念' },
    { date: addMonths(b, 3), label: '三个月' },
    { date: addMonths(b, 6), label: '半岁纪念' },
    { date: addMonths(b, 12), label: '周岁纪念' },
    { date: addMonths(b, 24), label: '两岁生日' },
    { date: addMonths(b, 36), label: '三岁生日' },
  ]
}

/** 距下一个纪念日的天数；at 是该纪念日当天 0 点的毫秒时间戳 */
export function daysUntilAnniversary(birthday: string, now = new Date()): { days: number; label: string; at: number } | null {
  const today = startOfDay(now)
  const candidates = anniversaryCandidates(birthday)
    .filter((entry) => entry.date.getTime() >= today)
    .sort((x, y) => x.date.getTime() - y.date.getTime())
  const next = candidates[0]
  if (!next) return null
  const days = Math.round((startOfDay(next.date) - today) / DAY)
  return { days, label: next.label, at: next.date.getTime() }
}
