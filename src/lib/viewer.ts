import type { AppState } from '../data/types'

/**
 * 当前操作者的显示名。
 * 正式环境由后端会话返回 viewerId；旧接口未带时回退到家庭管理员，再回退到「我」。
 */
export function viewerName(state: AppState): string {
  const byId = state.family.find((m) => m.id === state.viewerId)
  if (byId) return byId.name
  const admin = state.family.find((m) => m.permission === 'admin')
  return admin?.name ?? '我'
}
