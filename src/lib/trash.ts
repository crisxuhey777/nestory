import type { AppState } from '../data/types'

export const TRASH_DAYS = 7
export const TRASH_KEEP = 200

/**
 * 回收站只在本地留 7 天：服务端过期会彻底删掉 blob，本地条目再留着只会变成裂图。
 * 这一步跟着每次写入跑，不需要等用户进回收站页面。
 */
export function pruneTrash(state: AppState): AppState {
  const trash = state.trash ?? []
  const cutoff = Date.now() - TRASH_DAYS * 86_400_000
  const kept = trash.filter((entry) => entry.deletedAt >= cutoff).slice(-TRASH_KEEP)
  if (kept.length === trash.length) return state
  return { ...state, trash: kept }
}
