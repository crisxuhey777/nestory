import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { Dispatch, ReactNode } from 'react'
import type { AppState, Baby, DiaperRecord, FamilyMember, FeedRecord, GrowthRecord, Photo, Reminder, SleepRecord } from './types'
import type { RegisterInput, Session, User } from './api'
import { ApiError, api, isAppState } from './api'
import AuthScreen from '../components/AuthScreen'
import BootScreen from '../components/Boot'

export { isAppState }

type Action =
  | { type: 'addFeed'; feed: FeedRecord }
  | { type: 'updateFeed'; feed: FeedRecord }
  | { type: 'deleteFeed'; id: string }
  | { type: 'addSleep'; sleep: SleepRecord }
  | { type: 'endSleep'; id: string; endedAt: number }
  | { type: 'addDiaper'; diaper: DiaperRecord }
  | { type: 'addGrowth'; growth: GrowthRecord }
  | { type: 'addPhoto'; photo: Photo }
  | { type: 'setHeroPhotos'; ids: string[] }
  | { type: 'updateBaby'; baby: Partial<Baby> }
  | { type: 'removeFamilyMember'; id: string }
  | { type: 'updateFamilyMember'; id: string; patch: Partial<FamilyMember> }
  | { type: 'updateReminder'; reminder: Partial<Reminder> }
  | { type: 'sync'; at: number }
  | { type: 'hydrate'; state: AppState }
  | { type: 'completeOnboarding'; patch: Partial<AppState> }
  | { type: 'reset' }

function reducer(state: AppState, action: Action): AppState {
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
  const [state, apply] = useReducer(reducer, session.state)
  const [toasts, setToasts] = useState<Toast[]>([])
  const firstRender = useRef(true)
  const lastSaveError = useRef(0)

  const toast = useCallback((text: string) => {
    const id = Date.now() + Math.random()
    setToasts((prev) => [...prev, { id, text }])
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 2600)
  }, [])

  // 每次改动后自动保存（800ms 防抖）；AI 小结 hydrate 回来的新里程碑也会落库
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    const timer = setTimeout(() => {
      void api.saveState(state).catch((error) => {
        const now = Date.now()
        if (now - lastSaveError.current < 8000) return
        lastSaveError.current = now
        toast(error instanceof Error ? `保存失败：${error.message}` : '保存失败')
      })
    }, 800)
    return () => clearTimeout(timer)
  }, [state, toast])

  const dispatch = useCallback<Dispatch<Action>>(
    (action) => {
      if (action.type === 'reset') {
        void api
          .resetState()
          .then((next) => apply({ type: 'hydrate', state: next }))
          .catch((error) => toast(error instanceof Error ? error.message : '重置失败'))
        return
      }
      apply(action)
    },
    [toast],
  )

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const value = useMemo(
    () => ({ state, dispatch, user: session.user, toast, toasts, dismiss, signOut }),
    [state, dispatch, session.user, toast, toasts, dismiss, signOut],
  )

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export function useStore(): Store {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore must be used inside StoreProvider')
  return ctx
}
