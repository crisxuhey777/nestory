import type { Milestone } from '../data/types'

/**
 * 追加一条里程碑（AI 小结、纪念日都走这里）。
 * 同 id 只留一条：AI 请求超时后重试、或用户连点两次，都不会在时间轴上写重。
 */
export function appendMilestone(list: Milestone[], milestone: Milestone): Milestone[] {
  if (list.some((item) => item.id === milestone.id)) return list
  return [milestone, ...list]
}
