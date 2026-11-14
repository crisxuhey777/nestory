import { useCallback, useEffect, useState } from 'react'

export type Route =
  | 'home'
  | 'feed'
  | 'record'
  | 'growth'
  | 'album'
  | 'profile'
  | 'baby'
  | 'reminders'
  | 'about'
  | 'settings'
  | 'invite'
  | 'join'
  | 'trash'

const ROUTES: Route[] = [
  'home',
  'feed',
  'record',
  'growth',
  'album',
  'profile',
  'baby',
  'reminders',
  'about',
  'settings',
  'invite',
  'join',
  'trash',
]

const TITLES: Record<Route, string> = {
  home: 'Nestory · 家的小窝，成长的故事',
  feed: '喂养中心 · Nestory',
  record: '记录喂养 · Nestory',
  growth: '成长记录 · Nestory',
  album: '成长相册 · Nestory',
  profile: '我的家庭 · Nestory',
  baby: '宝宝资料 · Nestory',
  reminders: '提醒中心 · Nestory',
  about: '关于 Nestory',
  settings: '设置 · Nestory',
  invite: '邀请家人 · Nestory',
  join: '加入家庭 · Nestory',
  trash: '最近删除 · Nestory',
}

function parse(hash: string): Route {
  const raw = hash.replace(/^#\/?/, '').split('?')[0]
  return (ROUTES as string[]).includes(raw) ? (raw as Route) : 'home'
}

export type NavMode = 'none' | 'back'

export const TAB_ROUTES: Route[] = ['home', 'growth', 'album', 'profile']

const initialRoute = parse(window.location.hash)
if (!window.location.hash) history.replaceState(history.state, '', '#/home')
let trail: Route[] = [initialRoute]
let depth = 0
let pendingMode: NavMode = 'none'
let navSeq = 0

function emit() {
  window.dispatchEvent(new Event('hashchange'))
  window.scrollTo({ top: 0, behavior: 'auto' })
}

/**
 * 进入下一级：新增一条历史记录，硬件返回会先回到上一级，而不是继续堆积。
 * replace=true 用于底部 Tab 切换——同一层横向切换不应产生历史记录。
 */
export function navigate(route: Route, from?: Route, replace = false) {
  const next = `#/${route}${from ? `?from=${from}` : ''}`
  if (window.location.hash === next) return

  trail = trail.slice(0, depth + 1)
  if (replace) {
    const nextState = { ...(history.state ?? {}) } as Record<string, unknown>
    if (nextState.nestoryExitGuard) nextState.nestoryExitGuardPath = next
    history.replaceState(nextState, '', next)
    trail[depth] = route
  } else {
    // 新页面不继承退出确认哨兵，哨兵只留在被压在下面的根层条目上
    const nextState = { ...(history.state ?? {}) } as Record<string, unknown>
    delete nextState.nestoryExitGuard
    delete nextState.nestoryExitGuardPath
    history.pushState(nextState, '', next)
    trail.push(route)
    depth += 1
  }
  pendingMode = 'none'
  emit()
}

export function switchTab(route: Route) {
  navigate(route, undefined, true)
}

/** 返回上一级：有上一层就交给浏览器回退，否则替换为上一级。 */
export function goBack(route: Route, from?: Route) {
  const next = `#/${route}${from ? `?from=${from}` : ''}`
  if (window.location.hash === next) return

  const replaceToParent = () => {
    trail = trail.slice(0, depth + 1)
    trail[depth] = route
    history.replaceState(history.state, '', next)
    pendingMode = 'back'
    emit()
  }

  if (trail[depth - 1] === route) {
    const before = window.location.hash
    pendingMode = 'back'
    history.back()
    // 有些入口（刷新、直接打开二级页）会留下同 URL 的历史条目，
    // 此时 back() 不会改变 hash；短暂等待后改为替换到上一级。
    window.setTimeout(() => {
      if (window.location.hash === before) replaceToParent()
    }, 160)
    return
  }

  replaceToParent()
}

/** 读取 `#/xxx?from=yyy` 里的来源，用于决定二级页的返回目标。 */
export function getRouteFrom(): Route | null {
  const match = window.location.hash.match(/[?&]from=([a-z]+)/)
  const from = match?.[1]
  return from && (ROUTES as string[]).includes(from) ? (from as Route) : null
}

/** 读取 hash 里的查询参数（如邀请链接的 `?t=`）。 */
export function getHashParam(name: string): string | null {
  const match = window.location.hash.match(new RegExp(`[?&]${name}=([^&#]+)`))
  return match ? decodeURIComponent(match[1]) : null
}

/** 系统返回被退出确认拦截后，取消时把地址恢复到用户原本所在的根页面。 */
export function restoreRoute(route: Route) {
  const next = `#/${route}`
  if (window.location.hash === next) return
  trail = trail.slice(0, depth + 1)
  trail[depth] = route
  history.replaceState(history.state, '', next)
  pendingMode = 'none'
  emit()
}

/** 当前地址对应的路由（供系统返回等浏览器事件读取）。 */
export function currentRoute(): Route {
  return parse(window.location.hash)
}

export function useRoute() {
  const [view, setView] = useState<{ route: Route; mode: NavMode; key: number }>(() => ({
    route: parse(window.location.hash),
    mode: 'none',
    key: 0,
  }))

  useEffect(() => {
    const onChange = () => {
      const next = parse(window.location.hash)
      let mode = pendingMode
      pendingMode = 'none'

      if (mode === 'back') {
        // history.back() 或「替换为上一级」
        if (trail[depth - 1] === next) depth = Math.max(0, depth - 1)
        else {
          trail = trail.slice(0, depth + 1)
          trail[depth] = next
        }
        trail = trail.slice(0, depth + 1)
      } else if (trail[depth - 1] === next) {
        // 用户按浏览器/系统返回
        depth = Math.max(0, depth - 1)
        mode = 'back'
        trail = trail.slice(0, depth + 1)
      } else if (trail[depth + 1] === next) {
        depth += 1
      } else if (trail[depth] !== next) {
        // 直接改地址栏/Page.navigate：与浏览器历史保持一致，补一条 trail
        trail = trail.slice(0, depth + 1)
        trail.push(next)
        depth += 1
      }

      navSeq += 1
      setView({ route: next, mode, key: navSeq })
      window.scrollTo({ top: 0, behavior: 'auto' })
    }
    window.addEventListener('hashchange', onChange)
    if (!window.location.hash) window.location.replace('#/home')
    return () => window.removeEventListener('hashchange', onChange)
  }, [])

  useEffect(() => {
    document.title = TITLES[view.route]
  }, [view.route])

  const go = useCallback((r: Route) => navigate(r), [])
  return { route: view.route, mode: view.mode, viewKey: view.key, go }
}
