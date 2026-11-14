import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { pruneTrash, TRASH_DAYS, TRASH_KEEP } from '../src/lib/trash'
import type { AppState, TrashItem } from '../src/data/types'

const NOW = new Date('2026-11-14T12:00:00+08:00').getTime()
const DAY = 86_400_000

function entry(id: string, daysAgo: number): TrashItem {
  return { id, src: `data:${id}`, deletedAt: NOW - daysAgo * DAY } as TrashItem
}

function stateWith(trash: TrashItem[]): AppState {
  return { version: 3, trash } as unknown as AppState
}

describe('回收站本地裁剪', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('超过 7 天的条目被丢掉，未到期的保留', () => {
    const state = stateWith([entry('old', TRASH_DAYS + 0.1), entry('fresh', 1)])
    expect(pruneTrash(state).trash?.map((e) => e.id)).toEqual(['fresh'])
  })

  it('刚好 7 天前的条目仍在（边界不误删）', () => {
    const state = stateWith([entry('edge', TRASH_DAYS - 0.001)])
    expect(pruneTrash(state).trash).toHaveLength(1)
  })

  it(`超过 ${TRASH_KEEP} 条时只留最近的`, () => {
    const many = Array.from({ length: TRASH_KEEP + 5 }, (_, i) => entry(`p${i}`, 0))
    const kept = pruneTrash(stateWith(many)).trash ?? []
    expect(kept).toHaveLength(TRASH_KEEP)
    expect(kept[0].id).toBe('p5')
    expect(kept[kept.length - 1].id).toBe(`p${TRASH_KEEP + 4}`)
  })

  it('没有要裁的就原样返回同一个对象（避免多余重渲染）', () => {
    const state = stateWith([entry('a', 0)])
    expect(pruneTrash(state)).toBe(state)
  })

  it('没有 trash 字段时不抛错', () => {
    const state = { version: 3 } as unknown as AppState
    expect(pruneTrash(state)).toBe(state)
  })
})
