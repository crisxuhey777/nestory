import { describe, expect, it } from 'vitest'
import { appendMilestone } from '../src/lib/milestones'
import type { Milestone } from '../src/data/types'

const make = (id: string, title: string): Milestone => ({ id, at: 1_700_000_000_000, title, kind: 'milestone' })

describe('appendMilestone', () => {
  it('把新里程碑放在最前面', () => {
    const base = [make('a', '第一次翻身')]
    const next = appendMilestone(base, make('b', '第一次坐起来'))
    expect(next.map((m) => m.id)).toEqual(['b', 'a'])
    expect(base.map((m) => m.id)).toEqual(['a'])
  })

  it('同一个 id 只留一条（AI 重试、连点都不会写重）', () => {
    const base = [make('a', '第一次翻身')]
    const next = appendMilestone(base, make('a', '第一次翻身'))
    expect(next).toBe(base)
  })

  it('空列表直接放进一条', () => {
    expect(appendMilestone([], make('a', '第一次翻身')).map((m) => m.id)).toEqual(['a'])
  })
})
