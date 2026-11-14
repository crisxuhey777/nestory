/**
 * 喂养提醒的触发循环：挂在 Store 里，每 20 秒（以及页面重新可见时）检查一次。
 * 有通知权限就发系统通知，没有就在应用内提示一次；同一段间隔只提醒一次。
 */
import { useEffect, useRef } from 'react'
import type { AppState } from '../data/types'
import { dueReminder, minutesSinceLastFeed, reminderBody } from './reminder'
import { notificationPermission, notify } from './notify'

export const REMINDER_TICK_MS = 20_000
export const FIRED_KEY = 'nestory.reminder.fired.v1'

function readFired(): string | null {
  try {
    return localStorage.getItem(FIRED_KEY)
  } catch {
    return null
  }
}

function writeFired(key: string) {
  try {
    localStorage.setItem(FIRED_KEY, key)
  } catch {
    // 无痕模式写不进去就退化为每次打开提醒一次，可以接受
  }
}

export function useReminderAlert(state: AppState, toast: (text: string) => void) {
  // 定时器只挂一次：state 走 ref，避免「每记一笔就重建定时器并立刻 tick」。
  const stateRef = useRef(state)
  stateRef.current = state
  const toastRef = useRef(toast)
  toastRef.current = toast

  useEffect(() => {
    let cancelled = false
    let busy = false

    const tick = async (now = Date.now()) => {
      if (busy || cancelled) return
      const current = stateRef.current
      const due = dueReminder(current.feeds, current.reminder, now)
      if (!due) return
      if (readFired() === due.key) return

      busy = true
      try {
        const minutes = minutesSinceLastFeed(current.feeds, now) ?? Math.round(current.reminder.intervalMinutes)
        const body = reminderBody(minutes)
        let delivered = false
        if (notificationPermission() === 'granted') {
          const result = await notify('该喂奶啦', body, {
            tag: due.key,
            vibrate: current.reminder.vibration,
          })
          delivered = result.ok
        }
        if (!delivered) {
          // 通知被拒或失败：退回应用内提示，同样算投递成功，避免反复打扰。
          toastRef.current(`该喂奶啦 · ${body}`)
        }
        // 只有真的送到用户眼前才记「已提醒」：失败时下一轮会重试。
        if (!cancelled) writeFired(due.key)
      } finally {
        busy = false
      }
    }

    const timer = window.setInterval(() => void tick(), REMINDER_TICK_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void tick()
    }
    document.addEventListener('visibilitychange', onVisible)
    // 刚打开页面时也检查一次：可能已经过了提醒时间
    void tick()

    // 浏览器测试用的手动触发钩子（与 __nestoryErrors 同一类调试入口）
    const win = window as Window & { __nestoryReminderTick?: () => void }
    win.__nestoryReminderTick = () => void tick()

    return () => {
      cancelled = true
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      delete win.__nestoryReminderTick
    }
  }, [])
}
