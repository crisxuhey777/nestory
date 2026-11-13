/**
 * 喂养提醒的触发循环：挂在 Store 里，每 20 秒（以及页面重新可见时）检查一次。
 * 有通知权限就发系统通知，没有就在应用内提示一次；同一段间隔只提醒一次。
 */
import { useEffect } from 'react'
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
  useEffect(() => {
    let cancelled = false
    let busy = false

    const tick = async (now = Date.now()) => {
      if (busy || cancelled) return
      const due = dueReminder(state.feeds, state.reminder, now)
      if (!due) return
      if (readFired() === due.key) return

      busy = true
      try {
        writeFired(due.key)
        const minutes = minutesSinceLastFeed(state.feeds, now) ?? Math.round(state.reminder.intervalMinutes)
        const body = reminderBody(minutes)
        if (notificationPermission() === 'granted') {
          const result = await notify('该喂奶啦', body, {
            tag: due.key,
            vibrate: state.reminder.vibration,
          })
          if (result.ok) return
        }
        toast(`该喂奶啦 · ${body}`)
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
  }, [state, toast])
}
