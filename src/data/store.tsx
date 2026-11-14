import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { Dispatch, ReactNode } from 'react'
import type { AppState, Baby, DiaperRecord, FamilyMember, FeedRecord, GrowthRecord, Milestone, Photo, Reminder, SleepRecord, TrashItem } from './types'
import type { RegisterInput, Session, User } from './api'
import { ApiError, api, isAppState } from './api'
import AuthScreen from '../components/AuthScreen'
import BootScreen from '../components/Boot'
import { normalizeBirthState } from '../lib/birth'
import { pruneTrash } from '../lib/trash'
import { haptic } from '../lib/notify'
import { retryDelay } from '../lib/retry'
import { useReminderAlert } from '../lib/useReminderAlert'

export { isAppState }

/** 防抖窗口：连续记录时只发最后一次。 */
const SAVE_DELAY = 800
/** Fetch 对 keepalive 请求体有 64KiB 上限，超了会直接抛 TypeError（而且会被 catch 吞掉）。 */
const KEEPALIVE_LIMIT = 60_000
/** 上次离开页面时没保存成功的标记，下次启动提醒一句。 */
const UNSAVED_KEY = 'nestory.unsaved'

function bodyBytes(state: AppState): number {
  try {
    return new TextEncoder().encode(JSON.stringify({ state })).length
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

type Action =
  | { type: 'addFeed'; feed: FeedRecord }
  | { type: 'updateFeed'; feed: FeedRecord }
  | { type: 'deleteFeed'; id: string }
  | { type: 'addSleep'; sleep: SleepRecord }
  | { type: 'endSleep'; id: string; endedAt: number }
  | { type: 'addDiaper'; diaper: DiaperRecord }
  | { type: 'addGrowth'; growth: GrowthRecord }
  | { type: 'addPhoto'; photo: Photo }
  | { type: 'trashPhotos'; photos: Photo[]; deletedAt: number }
  | { type: 'restorePhotos'; ids: string[] }
  | { type: 'dropTrash'; ids: string[] }
  | { type: 'addMilestone'; milestone: Milestone }
  | { type: 'updatePhoto'; id: string; patch: Partial<Photo> }
  | { type: 'setPhotoVisuals'; visuals: { id: string; visualCaption: string; visualAt: number }[] }
  | { type: 'setHeroPhotos'; ids: string[] }
  | { type: 'updateBaby'; baby: Partial<Baby> }
  | { type: 'removeFamilyMember'; id: string }
  | { type: 'updateFamilyMember'; id: string; patch: Partial<FamilyMember> }
  | { type: 'updateReminder'; reminder: Partial<Reminder> }
  | { type: 'sync'; at: number }
  | { type: 'hydrate'; state: AppState }
  | { type: 'completeOnboarding'; patch: Partial<AppState> }
  | { type: 'reset' }

/** 触感反馈只给「保存一条记录」这类动作，切换开关不会震动。 */
const HAPTIC_ACTIONS: ReadonlySet<Action['type']> = new Set<Action['type']>([
  'addFeed',
  'updateFeed',
  'deleteFeed',
  'addSleep',
  'endSleep',
  'addDiaper',
  'addGrowth',
  'addPhoto',
  'addMilestone',
])

/** 回收站条目转回普通照片（去掉 deletedAt）。 */
function toPhoto(item: TrashItem): Photo {
  return {
    id: item.id,
    src: item.src,
    thumb: item.thumb,
    at: item.at,
    caption: item.caption,
    visualCaption: item.visualCaption,
    visualAt: item.visualAt,
    author: item.author,
    kind: item.kind,
    motion: item.motion,
    video: item.video,
    videoId: item.videoId,
    durationSec: item.durationSec,
  }
}

function rawReducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'addFeed':
      return { ...state, feeds: [...state.feeds, action.feed] }
    case 'updateFeed':
      return { ...state, feeds: state.feeds.map((f) => (f.id === action.feed.id ? action.feed : f)) }
    case 'deleteFeed':
      return { ...state, feeds: state.feeds.filter((f) => f.id !== action.id) }
    case 'addSleep':
      return { ...state, sleeps: [...state.sleeps, action.sleep] }
    case 'endSleep':
      return {
        ...state,
        sleeps: state.sleeps.map((s) => (s.id === action.id ? { ...s, endedAt: action.endedAt } : s)),
      }
    case 'addDiaper':
      return { ...state, diapers: [...state.diapers, action.diaper] }
    case 'addGrowth':
      return { ...state, growths: [...state.growths, action.growth] }
    case 'addPhoto':
      return { ...state, photos: [action.photo, ...state.photos] }
    case 'trashPhotos': {
      const ids = new Set(action.photos.map((p) => p.id))
      const trash = state.trash ?? []
      return {
        ...state,
        photos: state.photos.filter((p) => !ids.has(p.id)),
        trash: [
          ...action.photos.map((p) => ({ ...p, deletedAt: action.deletedAt })),
          ...trash.filter((t) => !ids.has(t.id)),
        ].slice(0, 200),
        heroPhotoIds: state.heroPhotoIds.filter((id) => !ids.has(id)),
      }
    }
    case 'restorePhotos': {
      const ids = new Set(action.ids)
      const trash = state.trash ?? []
      const restored = trash.filter((t) => ids.has(t.id)).map(toPhoto)
      return {
        ...state,
        photos: [...restored, ...state.photos],
        trash: trash.filter((t) => !ids.has(t.id)),
      }
    }
    case 'dropTrash': {
      const ids = new Set(action.ids)
      return { ...state, trash: (state.trash ?? []).filter((t) => !ids.has(t.id)) }
    }
    case 'addMilestone':
      return { ...state, milestones: [action.milestone, ...state.milestones] }
    case 'updatePhoto':
      return {
        ...state,
        photos: state.photos.map((p) =>
          p.id === action.id ? { ...p, ...action.patch } : p,
        ),
      }
    case 'setPhotoVisuals': {
      const byId = new Map(action.visuals.map((v) => [v.id, v]))
      return {
        ...state,
        photos: state.photos.map((p) => {
          const v = byId.get(p.id)
          return v ? { ...p, visualCaption: v.visualCaption, visualAt: v.visualAt } : p
        }),
      }
    }
    case 'setHeroPhotos':
      return { ...state, heroPhotoIds: action.ids }
    case 'updateBaby':
      return { ...state, baby: { ...state.baby, ...action.baby } }
    case 'removeFamilyMember':
      return { ...state, family: state.family.filter((m) => m.id !== action.id) }
    case 'updateFamilyMember':
      return {
        ...state,
        family: state.family.map((m) => (m.id === action.id ? { ...m, ...action.patch } : m)),
      }
    case 'updateReminder':
      return { ...state, reminder: { ...state.reminder, ...action.reminder } }
    case 'sync':
      return { ...state, lastSyncedAt: action.at }
    case 'hydrate':
      return action.state
    case 'completeOnboarding':
      return { ...state, ...action.patch, onboarded: true }
    case 'reset':
      // 真正实现由 dispatch 包装函数拦截：调用后端重置并接管返回的 state
      return state
    default:
      return state
  }
}

/** 所有写入都过一遍生日下界：非法记录会进入 archived，不会出现在主数组里。 */
function reducer(state: AppState, action: Action): AppState {
  return pruneTrash(normalizeBirthState(rawReducer(state, action)))
}

export function uid(prefix = 'r'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

type Toast = { id: number; text: string }

type Store = {
  state: AppState
  dispatch: Dispatch<Action>
  user: User
  toast: (text: string) => void
  toasts: Toast[]
  dismiss: (id: number) => void
  signOut: () => void
  /** 从后端重新拉一次状态（加入家庭、换头像后需要） */
  reload: () => Promise<void>
  /** 当前账号在这个家里的权限；只读成员只能看。 */
  permission: FamilyMember['permission'] | undefined
  /** permission 不是 read；只读成员的写入会被后端 403，这里先拦住。 */
  canWrite: boolean
}

const StoreContext = createContext<Store | null>(null)

type Boot =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'anon' }
  | { status: 'ready'; session: Session }

/**
 * 启动顺序：GET /api/auth/me
 *   401 → 登录/注册页
 *   200 → 直接用返回的 AppState 渲染（数据来自 MySQL，cookie 会话自动带上）
 * 请求成功之前不渲染业务页面，所以首屏内容一定来自数据库。
 */
export function StoreProvider({ children }: { children: ReactNode }) {
  const [boot, setBoot] = useState<Boot>({ status: 'loading' })

  useEffect(() => {
    let alive = true
    const controller = new AbortController()

    void (async () => {
      try {
        const session = await api.me()
        if (alive) setBoot({ status: 'ready', session })
      } catch (error) {
        if (!alive || controller.signal.aborted) return
        if (error instanceof ApiError && error.status === 401) {
          setBoot({ status: 'anon' })
          return
        }
        setBoot({
          status: 'error',
          message: error instanceof Error ? error.message : String(error),
        })
      }
    })()

    return () => {
      alive = false
      controller.abort()
    }
  }, [])

  const signIn = useCallback(async (email: string, password: string) => {
    const session = await api.login(email, password)
    setBoot({ status: 'ready', session })
  }, [])

  const signUp = useCallback(async (input: RegisterInput) => {
    const session = await api.register(input)
    setBoot({ status: 'ready', session })
  }, [])

  const signOut = useCallback(() => {
    void api.logout().catch(() => undefined)
    setBoot({ status: 'anon' })
  }, [])

  if (boot.status === 'loading') {
    return <BootScreen status="loading" />
  }

  if (boot.status === 'error') {
    return (
      <BootScreen
        status="error"
        message={boot.message}
        onRetry={() => window.location.reload()}
      />
    )
  }

  if (boot.status === 'anon') {
    return <AuthScreen onSignIn={signIn} onSignUp={signUp} />
  }

  return (
    <ReadyStore key={boot.session.user.id} session={boot.session} signOut={signOut}>
      {children}
    </ReadyStore>
  )
}

function ReadyStore({
  session,
  signOut,
  children,
}: {
  session: Session
  signOut: () => void
  children: ReactNode
}) {
  const [state, apply] = useReducer(reducer, session.state, (raw) => pruneTrash(normalizeBirthState(raw)))
  const [toasts, setToasts] = useState<Toast[]>([])
  const firstRender = useRef(true)
  const lastSaveError = useRef(0)

  const toast = useCallback((text: string) => {
    const id = Date.now() + Math.random()
    setToasts((prev) => [...prev, { id, text }])
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 2600)
  }, [])

  // 到点提醒：有系统通知权限就走通知，否则退回应用内提示
  useReminderAlert(state, toast)

  const permission = useMemo(
    () => state.family.find((m) => m.id === state.viewerId)?.permission,
    [state.family, state.viewerId],
  )
  const canWrite = permission !== 'read'
  const viewerId = state.viewerId

  const saveChain = useRef<Promise<unknown>>(Promise.resolve())
  const latestState = useRef(state)
  const dirty = useRef(false)
  /** 失败重试的定时器与次数（网络恢复前一直留着，别把改动丢掉）。 */
  const retryTimer = useRef<number | null>(null)
  const retryAttempt = useRef(0)
  /** 重试时总是发最新快照；这里由渲染期赋值，避免 queueSave 依赖自己。 */
  const retryRef = useRef<() => void>(() => undefined)
  /** reload() 带回来的状态不需要再回写一遍（只读成员回写还会 403） */
  const skipNextSave = useRef(false)

  const clearRetry = useCallback(() => {
    if (retryTimer.current === null) return
    window.clearTimeout(retryTimer.current)
    retryTimer.current = null
  }, [])

  const armRetry = useCallback(() => {
    if (retryTimer.current !== null) return
    const delay = retryDelay(retryAttempt.current)
    retryAttempt.current += 1
    retryTimer.current = window.setTimeout(() => {
      retryTimer.current = null
      retryRef.current()
    }, delay)
  }, [])

  const recordSaveError = useCallback((message: string) => {
    try {
      localStorage.setItem(UNSAVED_KEY, message)
    } catch {
      /* 隐私模式下写不进去就算了 */
    }
  }, [])

  const clearSaveError = useCallback(() => {
    try {
      localStorage.removeItem(UNSAVED_KEY)
    } catch {
      /* 同上 */
    }
  }, [])

  // 上次离开时如果有改动没发出去，这次进来提醒一下（比静默吞掉好）。
  useEffect(() => {
    let pending = ''
    try {
      pending = localStorage.getItem(UNSAVED_KEY) ?? ''
    } catch {
      return
    }
    if (!pending) return
    clearSaveError()
    toast('上次离开时的改动可能没保存，请确认最新记录')
  }, [clearSaveError, toast])

  useEffect(() => {
    latestState.current = state
  }, [state])

  /** 把最新快照排进串行链；返回的 Promise 不会 reject。 */
  const queueSave = useCallback(
    (snapshot: AppState, keepalive = false) => {
      saveChain.current = saveChain.current
        .catch(() => undefined)
        .then(() => api.saveState(snapshot, keepalive))
        .then(() => {
          clearRetry()
          retryAttempt.current = 0
          clearSaveError()
          if (latestState.current === snapshot) dirty.current = false
        })
        .catch((error: unknown) => {
          recordSaveError(error instanceof Error ? error.message : '保存失败')
          if (error instanceof ApiError && error.status === 401) {
            signOut()
            return
          }
          const now = Date.now()
          if (now - lastSaveError.current >= 8000) {
            lastSaveError.current = now
            toast(error instanceof Error ? `保存失败：${error.message}` : '保存失败')
          }
          // 网络/服务端临时故障：改动留在 dirty 里，按退避节奏重发。
          armRetry()
        })
      return saveChain.current
    },
    [armRetry, clearRetry, clearSaveError, recordSaveError, signOut, toast],
  )

  retryRef.current = () => {
    if (!dirty.current) return
    void queueSave(latestState.current)
  }

  // 网络恢复时立刻补发，不用等下一个退避周期。
  useEffect(() => {
    const retryNow = () => {
      if (!dirty.current) return
      clearRetry()
      retryAttempt.current = 0
      void queueSave(latestState.current)
    }
    window.addEventListener('online', retryNow)
    return () => window.removeEventListener('online', retryNow)
  }, [clearRetry, queueSave])

  /** 立即把未保存的改动补发出去（卸载 / 切后台 / 退出登录前）。 */
  const flushPending = useCallback(
    (keepalive: boolean) => {
      if (!dirty.current) return Promise.resolve()
      const snapshot = latestState.current
      return queueSave(snapshot, keepalive && bodyBytes(snapshot) <= KEEPALIVE_LIMIT)
    },
    [queueSave],
  )

  // 关闭/刷新页面、切到后台时尽量把最后一次改动补发出去。
  useEffect(() => {
    const flush = () => {
      void flushPending(true)
    }
    const onHide = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onHide)
    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onHide)
    }
  }, [flushPending])

  // 卸载（退出登录 / 切换账号）时不能把 800ms 内的改动丢掉。
  useEffect(() => {
    return () => {
      void flushPending(true)
      clearRetry()
    }
  }, [clearRetry, flushPending])

  // 每次改动后自动保存（800ms 防抖），并用串行链避免旧请求覆盖新状态
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    if (skipNextSave.current) {
      skipNextSave.current = false
      latestState.current = state
      return
    }
    const snapshot = state
    latestState.current = snapshot
    dirty.current = true
    const timer = setTimeout(() => {
      void queueSave(snapshot)
    }, SAVE_DELAY)
    return () => clearTimeout(timer)
  }, [state, queueSave])

  const dispatch = useCallback<Dispatch<Action>>(
    (action) => {
      // 只读成员：后端会 403，本地先拦住，避免「看起来记上了、8 秒后报错」。
      // 例外：换自己的头像（后端 family.set_avatar 对 read 成员是允许的）。
      const ownAvatar =
        action.type === 'updateFamilyMember' &&
        action.id === viewerId &&
        Object.keys(action.patch ?? {}).every((key) => key === 'avatarUrl')
      if (permission === 'read' && !ownAvatar && action.type !== 'hydrate' && action.type !== 'sync') {
        toast('只读成员只能查看，不能修改记录')
        return
      }
      if (action.type === 'reset') {
        void api
          .resetState()
          .then((next) => apply({ type: 'hydrate', state: next }))
          .catch((error) => toast(error instanceof Error ? error.message : '重置失败'))
        return
      }
      // 记录保存成功时给一次很轻的振动（可在提醒中心关闭）
      if (HAPTIC_ACTIONS.has(action.type) && latestState.current.reminder.vibration) haptic(8)
      apply(action)
    },
    [permission, toast, viewerId],
  )

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const reload = useCallback(async () => {
    try {
      const session = await api.me()
      skipNextSave.current = true
      apply({ type: 'hydrate', state: session.state })
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        signOut()
        return
      }
      toast(error instanceof Error ? error.message : '刷新失败')
    }
  }, [signOut, toast])

  /** 退出登录前先把未保存的改动发出去，否则最后一次修改会随组件卸载消失。 */
  const leave = useCallback(() => {
    void flushPending(false).then(() => signOut())
  }, [flushPending, signOut])

  const value = useMemo(
    () => ({
      state,
      dispatch,
      user: session.user,
      toast,
      toasts,
      dismiss,
      signOut: leave,
      reload,
      permission,
      canWrite,
    }),
    [state, dispatch, session.user, toast, toasts, dismiss, leave, reload, permission, canWrite],
  )

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export function useStore(): Store {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore must be used inside StoreProvider')
  return ctx
}
