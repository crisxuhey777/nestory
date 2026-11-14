import { describe, expect, it } from 'vitest'
import { retryDelay, retrySchedule } from '../src/lib/retry'

describe('保存失败重试节奏', () => {
  it('依次是 5s、15s，之后固定每分钟', () => {
    expect(retrySchedule()).toEqual([5_000, 15_000, 60_000])
    expect([0, 1, 2, 3, 10].map(retryDelay)).toEqual([5_000, 15_000, 60_000, 60_000, 60_000])
  })

  it('非法输入退化成第一档，不会返回 NaN', () => {
    expect(retryDelay(-1)).toBe(5_000)
    expect(retryDelay(Number.NaN)).toBe(5_000)
    expect(retryDelay(1.7)).toBe(15_000)
  })
})
