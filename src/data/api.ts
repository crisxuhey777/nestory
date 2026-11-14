import type { AppState } from './types'

export type User = {
  id: number
  email: string
  nickname: string
  babyName: string
  babyBirthday: string | null
  isDemo?: boolean
  createdAt: string | null
  avatarUrl?: string | null
}

export type Session = { user: User; state: AppState; rev: number }

export type Permission = 'admin' | 'edit' | 'read'

export type FamilyMemberDto = {
  id: string
  name: string
  role: string
  color: string
  permission: Permission
  avatarUrl: string | null
  joinedAt: string | null
}

export type MergedCounts = Partial<Record<'feeds' | 'sleeps' | 'diapers' | 'growths' | 'milestones' | 'photos' | 'trash', number>>

export type FamilyPayload = {
  household: { id: number; name: string; createdAt?: string | null }
  me: { userId: string; permission: Permission; isAdmin: boolean }
  members: FamilyMemberDto[]
  /** 加入家庭时，自己原来的记录被并进新家庭的条数（按列表） */
  merged?: MergedCounts
}

export type InvitePayload = { token: string; permission: Permission; expiresAt: string; days: number }

export type InvitePreview = {
  status: 'ok' | 'used' | 'expired'
  household: { id: number; name: string }
  permission: Permission
  inviter: string
  expiresAt: string
}

export type MediaKind = 'photo' | 'video' | 'live'

export type MediaPresignInput = {
  kind: MediaKind
  mime: string
  bytes: number
  width?: number
  height?: number
  durationSec?: number
  sha256?: string
  /** 换头像上传：只读成员也可以，后端只允许 photo */
  purpose?: 'avatar'
  /** 强制走应用服务器中转（本地驱动或对象存储临时不可用时） */
  proxy?: boolean
}

export type MediaPresign = {
  id: string
  mode: 's3' | 'proxy'
  method: string
  uploadUrl: string
  headers: Record<string, string>
  url: string
  expiresIn?: number
}

export type MediaUsage = { items: number; bytes: number; quotaBytes: number }

export type MediaItem = {
  id: string
  kind: MediaKind
  bytes: number
  mime: string
  width: number | null
  height: number | null
  durationSec: number | null
  createdAt: number | null
  url: string
}

/** 回收站条目：服务端只留 7 天，前端用它显示剩余时间。 */
export type TrashItemDto = {
  id: string
  kind: MediaKind
  bytes: number
  mime: string
  width: number | null
  height: number | null
  author: string
  createdAt: string | null
  deletedAt: string | null
  expiresAt: string | null
  url: string
}

export type RegisterInput = {
  email: string
  password: string
  nickname: string
}

export class ApiError extends Error {
  status: number
  code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

export function isAppState(value: unknown): value is AppState {
  if (!value || typeof value !== 'object') return false
  const state = value as Partial<AppState>
  const lists = [
    state.feeds,
    state.sleeps,
    state.diapers,
    state.growths,
    state.milestones,
    state.photos,
    state.family,
    state.heroPhotoIds,
  ]
  return (
    state.version === 3 &&
    !!state.baby &&
    typeof state.baby.name === 'string' &&
    typeof state.baby.birthday === 'string' &&
    (state.baby.birthday === '' || /^\d{4}-\d{2}-\d{2}$/.test(state.baby.birthday)) &&
    lists.every(Array.isArray) &&
    !!state.reminder &&
    typeof state.reminder === 'object' &&
    typeof state.reminder.enabled === 'boolean' &&
    typeof state.reminder.intervalMinutes === 'number' &&
    Number.isFinite(state.reminder.intervalMinutes) &&
    typeof state.reminder.quietNight === 'boolean' &&
    typeof state.reminder.vibration === 'boolean'
  )
}

/** `timeoutMs` 覆盖默认 20s：AI 生成最长要 40 秒以上。 */
type ApiInit = RequestInit & { timeoutMs?: number }

async function request<T>(path: string, init: ApiInit = {}): Promise<T> {
  const { timeoutMs = 20_000, signal: outerSignal, ...rest } = init
  const controller = new AbortController()
  const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs)
  // 调用方可以传自己的 signal（例如关掉弹窗时取消 AI 请求）。
  // 调用方取消和超时是两回事，错误码要分开。
  const forwardAbort = () => controller.abort()
  if (outerSignal) {
    if (outerSignal.aborted) controller.abort()
    else outerSignal.addEventListener('abort', forwardAbort, { once: true })
  }
  let res: Response
  let text: string
  try {
    res = await fetch(path, {
      credentials: 'same-origin',
      ...rest,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(rest.body ? { 'Content-Type': 'application/json' } : {}),
        ...(rest.headers ?? {}),
      },
    })
    text = await res.text()
  } catch {
    if (outerSignal?.aborted) {
      throw new ApiError(0, 'aborted', '请求已取消')
    }
    if (controller.signal.aborted) {
      throw new ApiError(0, 'timeout', '请求超时，请稍后再试')
    }
    throw new ApiError(0, 'network', '暂时连不上 Nestory，请稍后再试')
  } finally {
    globalThis.clearTimeout(timer)
    outerSignal?.removeEventListener('abort', forwardAbort)
  }

  let payload: unknown = null
  if (text) {
    try {
      payload = JSON.parse(text)
    } catch {
      payload = null
    }
  }

  if (!res.ok) {
    const body = (payload ?? {}) as { error?: string; message?: string }
    if (res.status === 503) {
      throw new ApiError(503, body.error ?? 'db_unavailable', '服务暂时不可用，请稍后再试')
    }
    throw new ApiError(res.status, body.error ?? `http_${res.status}`, body.message ?? `请求失败（HTTP ${res.status}）`)
  }

  return payload as T
}

/**
 * 页面里所有 POST /api/ai/* 都走这里：统一超时、统一 ApiError、统一 credentials。
 * 生成类接口本身要几十秒，所以默认放宽到 90 秒。
 */
export async function aiPost<T>(path: string, body: unknown, timeoutMs = 90_000): Promise<T> {
  return request<T>(path, { method: 'POST', body: JSON.stringify(body), timeoutMs })
}

function session(payload: { user: User; state: unknown; rev?: number }): Session {
  if (!isAppState(payload.state)) throw new ApiError(500, 'bad_state', '数据加载失败，请刷新后再试')
  return { user: payload.user, state: payload.state, rev: typeof payload.rev === 'number' ? payload.rev : 0 }
}

export const api = {
  me: async (): Promise<Session> => session(await request<{ user: User; state: unknown }>('/api/auth/me')),

  login: async (email: string, password: string): Promise<Session> =>
    session(
      await request<{ user: User; state: unknown }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      }),
    ),

  register: async (input: RegisterInput): Promise<Session> =>
    session(
      await request<{ user: User; state: unknown }>('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    ),

  logout: async (): Promise<void> => {
    await request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' })
  },

  /** 保存整份状态；带上版本号就走乐观锁，返回写入后的新版本号。 */
  saveState: async (state: AppState, keepalive = false, rev?: number | null): Promise<number> => {
    const payload = await request<{ ok: boolean; rev?: number }>('/api/state', {
      method: 'PUT',
      body: JSON.stringify({ state }),
      keepalive,
      headers: typeof rev === 'number' ? { 'If-Match': String(rev) } : undefined,
    })
    return typeof payload.rev === 'number' ? payload.rev : 0
  },

  resetState: async (): Promise<{ state: AppState; rev: number }> => {
    const payload = await request<{ state: unknown; rev?: number }>('/api/state/reset', { method: 'POST' })
    if (!isAppState(payload.state)) throw new ApiError(500, 'bad_state', '数据加载失败，请刷新后再试')
    return { state: payload.state, rev: typeof payload.rev === 'number' ? payload.rev : 0 }
  },

  family: (): Promise<FamilyPayload> => request<FamilyPayload>('/api/family'),

  createInvite: (permission: Permission): Promise<InvitePayload> =>
    request<InvitePayload>('/api/family/invite', {
      method: 'POST',
      body: JSON.stringify({ permission }),
    }),

  previewInvite: (token: string): Promise<InvitePreview> =>
    request<InvitePreview>(`/api/family/invite/${encodeURIComponent(token)}`),

  joinFamily: (token: string): Promise<FamilyPayload> =>
    request<FamilyPayload>('/api/family/join', {
      method: 'POST',
      body: JSON.stringify({ token }),
    }),

  updateMember: (userId: string, permission: Permission): Promise<{ ok: boolean; userId: string; permission: Permission }> =>
    request<{ ok: boolean; userId: string; permission: Permission }>('/api/family/member/update', {
      method: 'POST',
      body: JSON.stringify({ userId, permission }),
    }),

  removeMember: (userId: string): Promise<{ ok: boolean; userId: string }> =>
    request<{ ok: boolean; userId: string }>('/api/family/member/remove', {
      method: 'POST',
      body: JSON.stringify({ userId }),
    }),

  setAvatar: (mediaId: string): Promise<{ ok: boolean; avatarUrl: string }> =>
    request<{ ok: boolean; avatarUrl: string }>('/api/me/avatar', {
      method: 'POST',
      body: JSON.stringify({ mediaId }),
    }),
}

export const mediaApi = {
  presign: (input: MediaPresignInput): Promise<MediaPresign> =>
    request<MediaPresign>('/api/media/presign', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  confirm: (id: string): Promise<{ id: string; url: string }> =>
    request<{ id: string; url: string }>(`/api/media/${id}/confirm`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  list: (): Promise<{ items: MediaItem[]; usage: MediaUsage }> =>
    request<{ items: MediaItem[]; usage: MediaUsage }>('/api/media'),

  remove: (id: string): Promise<{ ok: boolean; id: string; days: number }> =>
    request<{ ok: boolean; id: string; days: number }>(`/api/media/${id}`, { method: 'DELETE' }),

  trash: (): Promise<{ items: TrashItemDto[]; days: number }> =>
    request<{ items: TrashItemDto[]; days: number }>('/api/media/trash'),

  restore: (id: string): Promise<{ ok: boolean; id: string; restored?: boolean; url?: string }> =>
    request<{ ok: boolean; id: string; restored?: boolean; url?: string }>(`/api/media/${id}/restore`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
}
