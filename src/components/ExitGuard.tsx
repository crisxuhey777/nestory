import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { currentRoute, restoreRoute, TAB_ROUTES } from '../lib/route'
import type { Route } from '../lib/route'
import { Sheet } from './Sheet'

type GuardState = { nestoryExitGuard?: boolean } | null

/**
 * 主界面再按返回时，先弹一次确认，不直接退出应用。
 *
 * 浏览器只有在「当前条目之后还有一条历史」时才会拦下返回，所以在页面根层
 * 压一条同 URL 的哨兵条目；用户按返回时先消费哨兵，弹出确认：
 * 取消则补回哨兵，确认则再退一步真正离开。
 */
export default function ExitGuard({ route }: { route: Route }) {
  const [open, setOpen] = useState(false)
  const openRef = useRef(false)
  const allowExit = useRef(false)
  const prevRoot = useRef(TAB_ROUTES.includes(route))
  const prevRoute = useRef(route)
  const restoreTo = useRef<Route | null>(null)

  const isRoot = TAB_ROUTES.includes(route)

  const pushGuard = () => {
    const state = (history.state ?? {}) as GuardState & { nestoryExitGuardPath?: string }
    const path = window.location.hash || '#/home'
    if (state?.nestoryExitGuard && state.nestoryExitGuardPath === path) return
    history.pushState({ ...state, nestoryExitGuard: true, nestoryExitGuardPath: path }, '', window.location.href)
  }

  useEffect(() => {
    openRef.current = open
  }, [open])

  // 根层始终保留一条哨兵；进入二级页时 navigate 会替换掉它。
  useEffect(() => {
    if (isRoot && !openRef.current) pushGuard()
  }, [isRoot, route])

  useLayoutEffect(() => {
    prevRoot.current = isRoot
    prevRoute.current = route
    // 页面已经切换（例如确认框之外的跳转），退出确认不应跨页残留
    if (openRef.current) {
      setOpen(false)
      restoreTo.current = null
    }
  }, [isRoot, route])

  useEffect(() => {
    const onPop = () => {
      if (allowExit.current) return

      const atRoot = TAB_ROUTES.includes(currentRoute())
      const wasRoot = prevRoot.current
      const guarded = Boolean((history.state as GuardState)?.nestoryExitGuard)

      const now = currentRoute()
      const backdrop = document.querySelector('.sheet-backdrop') as HTMLElement | null
      if (atRoot && wasRoot && !guarded && backdrop) {
        // 有抽屉打开时，返回先关抽屉，不触发退出
        backdrop.click()
        restoreRoute(prevRoute.current)
        pushGuard()
        return
      }

      if (atRoot && wasRoot && !guarded && now === prevRoute.current) {
        const before = now
        // 刚消费掉根层哨兵：这是「在主界面按了返回」
        restoreRoute(before)
        restoreTo.current = null
        setOpen(true)
        return
      }

      if (atRoot && !guarded) pushGuard()
    }

    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const cancel = () => {
    setOpen(false)
    if (restoreTo.current) {
      restoreRoute(restoreTo.current)
      restoreTo.current = null
    }
    pushGuard()
  }

  const confirm = () => {
    allowExit.current = true
    restoreTo.current = null
    setOpen(false)
    history.back()
  }

  return (
    <Sheet
      open={open}
      onClose={cancel}
      title="要离开 Nestory 吗？"
      desc="今天的记录已经自动保存；下次打开时再继续。"
      footer={
        <div className="exit-actions">
          <button className="btn btn--quiet" type="button" onClick={cancel}>
            继续使用
          </button>
          <button className="btn btn--primary" type="button" onClick={confirm}>
            退出应用
          </button>
        </div>
      }
    >
      <p className="exit-note">退出后需要重新登录，记录仍保存在这台设备上。</p>
    </Sheet>
  )
}
