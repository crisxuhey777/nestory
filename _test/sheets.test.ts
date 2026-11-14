import { describe, expect, it } from 'vitest'
import { closeTopSheet, hasOpenSheet, registerSheet } from '../src/lib/sheets'

describe('抽屉登记表', () => {
  it('登记后视为有抽屉打开，注销后清空', () => {
    const off = registerSheet(() => {})
    expect(hasOpenSheet()).toBe(true)
    off()
    expect(hasOpenSheet()).toBe(false)
  })

  it('返回键先关最后打开的那一个', () => {
    const closed: number[] = []
    const offFirst = registerSheet(() => closed.push(1))
    const offSecond = registerSheet(() => closed.push(2))

    expect(closeTopSheet()).toBe(true)
    expect(closed).toEqual([2])

    offSecond()
    expect(closeTopSheet()).toBe(true)
    expect(closed).toEqual([2, 1])

    offFirst()
    expect(closeTopSheet()).toBe(false)
  })

  it('没有抽屉时 closeTopSheet 返回 false 且不抛错', () => {
    expect(closeTopSheet()).toBe(false)
  })
})
