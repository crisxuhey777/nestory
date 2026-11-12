import type { AppState } from './types'

export type User = {
  id: number
  email: string
  nickname: string
  babyName: string
  babyBirthday: string | null
  createdAt: string | null
}

export type Session = { user: User; state: AppState }

export type MediaKind = 'photo' | 'video' | 'live'

export type MediaPresignInput = {
  kind: MediaKind
  mime: string
  bytes: number
  width?: number
  height?: number
  durationSec?: number
  sha256?: string
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

export type RegisterInput = {
  email: string
  password: string
  nickname: string
  babyName: string
  babyBirthday: string
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

export function unwrapState(payload: unknown): unknown {
  if (payload && typeof payload === 'object' && 'state' in payload) {
    return (payload as { state: unknown }).state
  }
  return payload
}

export function isAppState(value: unknown): value is AppState {
  if (!value || typeof value !== 'object') return false
  const state = value as Partial<AppState>
  return state.version === 3 && !!state.baby && Array.isArray(state.feeds) && Array.isArray(state.photos)
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      credentials: 'same-origin',
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init.headers ?? {}),
      },
    })
  } catch {
    throw new ApiError(0, 'network', '连不上本地后端，先运行 python backend/server.py')
  }

  const text = await res.text()
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
      throw new ApiError(503, body.error ?? 'db_unavailable', 'MySQL 没有连上，请先启动数据库')
    }
    throw new ApiError(res.status, body.error ?? `http_${res.status}`, body.message ?? `请求失败（HTTP ${res.status}）`)
  }

  return payload as T
}

function session(payload: { user: User; state: unknown }): Session {
  if (!isAppState(payload.state)) throw new ApiError(500, 'bad_state', '后端返回的数据不是 AppState v3')
  return { user: payload.user, state: payload.state }
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

  saveState: async (state: AppState): Promise<void> => {
    await request<{ ok: boolean }>('/api/state', {
      method: 'PUT',
      body: JSON.stringify({ state }),
    })
  },

  resetState: async (): Promise<AppState> => {
    const payload = await request<{ state: unknown }>('/api/state/reset', { method: 'POST' })
    if (!isAppState(payload.state)) throw new ApiError(500, 'bad_state', '后端返回的数据不是 AppState v3')
    return payload.state
  },
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

  remove: (id: string): Promise<{ ok: boolean; id: string }> =>
    request<{ ok: boolean; id: string }>(`/api/media/${id}`, { method: 'DELETE' }),
}
