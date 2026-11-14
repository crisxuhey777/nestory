import { describe, expect, it } from 'vitest'
import { daysUntilAnniversary } from '../src/lib/date'

describe('daysUntilAnniversary', () => {
  it('满月按自然月算，不是固定 30 天', () => {
    const next = daysUntilAnniversary('2026-10-21', new Date(2026, 10, 14))
    expect(next?.label).toBe('满月纪念')
    expect(next?.days).toBe(7)
    expect(new Date(next!.at).getDate()).toBe(21)
  })

  it('百天和三个月分开计算', () => {
    const early = daysUntilAnniversary('2026-08-01', new Date(2026, 9, 5))
    expect(early?.label).toBe('三个月')
    const late = daysUntilAnniversary('2026-08-01', new Date(2026, 10, 2))
    expect(late?.label).toBe('百天纪念')
    expect(late?.days).toBe(7)
  })

  it('当天显示 0 天', () => {
    const next = daysUntilAnniversary('2026-08-01', new Date(2026, 8, 1))
    expect(next?.label).toBe('满月纪念')
    expect(next?.days).toBe(0)
  })

  it('周岁之后还有两岁、三岁', () => {
    const first = daysUntilAnniversary('2025-11-20', new Date(2026, 10, 14))
    expect(first?.label).toBe('周岁纪念')
    expect(first?.days).toBe(6)
    const second = daysUntilAnniversary('2025-11-20', new Date(2026, 10, 21))
    expect(second?.label).toBe('两岁生日')
    const third = daysUntilAnniversary('2024-11-20', new Date(2026, 10, 21))
    expect(third?.label).toBe('三岁生日')
  })

  it('月底生日夹到当月最后一天', () => {
    const next = daysUntilAnniversary('2026-01-31', new Date(2026, 1, 1))
    expect(next?.label).toBe('满月纪念')
    expect(next?.days).toBe(27)
    expect(new Date(next!.at).getDate()).toBe(28)
  })

  it('三岁以后没有候选', () => {
    expect(daysUntilAnniversary('2020-01-01', new Date(2026, 10, 14))).toBeNull()
  })
})
