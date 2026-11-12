import { useCallback, useEffect, useState } from 'react'

export type Route =
  | 'home'
  | 'feed'
  | 'record'
  | 'growth'
  | 'album'
  | 'profile'
  | 'reminders'
  | 'about'
  | 'settings'

const ROUTES: Route[] = [
  'home',
  'feed',
  'record',
  'growth',
  'album',
  'profile',
  'reminders',
  'about',
  'settings',
]

const TITLES: Record<Route, string> = {
  home: 'Nestory · 家的小窝，成长的故事',
  feed: '喂养中心 · Nestory',
  record: '记录喂养 · Nestory',
  growth: '成长记录 · Nestory',
  album: '成长相册 · Nestory',
  profile: '我的家庭 · Nestory',
  reminders: '提醒中心 · Nestory',
  about: '关于 Nestory',
  settings: '设置 · Nestory',
}

function parse(hash: string): Route {
  const raw = hash.replace(/^#\/?/, '').split('?')[0]
  return (ROUTES as string[]).includes(raw) ? (raw as Route) : 'home'
}

export type NavMode = 'none' | 'back'

let pendingMode: NavMode = 'none'
let navSeq = 0

export function navigate(route: Route, from?: Route) {
  pendingMode = 'none'
  const next = `#/${route}${from ? `?from=${from}` : ''}`
  if (window.location.hash === next) return
  window.location.hash = next
  window.scrollTo({ top: 0, behavior: 'auto' })
}

/** 返回上一级：标记为 back，让新页面从左侧轻微滑入。 */
export function goBack(route: Route, from?: Route) {
  pendingMode = 'back'
  const next = `#/${route}${from ? `?from=${from}` : ''}`
  if (window.location.hash === next) {
    pendingMode = 'none'
    return
  }
  window.location.hash = next
  window.scrollTo({ top: 0, behavior: 'auto' })
}

/** 读取 `#/xxx?from=yyy` 里的来源，用于决定二级页的返回目标。 */
export function getRouteFrom(): Route | null {
  const match = window.location.hash.match(/[?&]from=([a-z]+)/)
  const from = match?.[1]
  return from && (ROUTES as string[]).includes(from) ? (from as Route) : null
}

export function useRoute() {
  const [view, setView] = useState<{ route: Route; mode: NavMode; key: number }>(() => ({
    route: parse(window.location.hash),
    mode: 'none',
    key: 0,
  }))

  useEffect(() => {
    const onChange = () => {
      const mode = pendingMode
      pendingMode = 'none'
      navSeq += 1
      setView({ route: parse(window.location.hash), mode, key: navSeq })
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
