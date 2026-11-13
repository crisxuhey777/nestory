/**
 * 系统通知与轻振动。
 *
 * 优先走 Service Worker 的 showNotification：Android 安装到桌面后即使页面在后台也能弹；
 * 没有 SW 或浏览器不支持时退回 `new Notification`。两者都失败就交给调用方做应用内提示。
 */
import { navigate } from './route'

export type NotifyPermission = NotificationPermission | 'unsupported'

export type NotifyResult = {
  ok: boolean
  via: 'service-worker' | 'notification' | 'none'
  reason?: string
}

type DebugWindow = Window & {
  __nestoryLastNotification?: { title: string; body: string; at: number; via: string }
}

export const NOTIFY_ICON = '/brand/app-icon-180.png'

export function notificationPermission(): NotifyPermission {
  if (typeof window === 'undefined' || typeof Notification === 'undefined') return 'unsupported'
  return Notification.permission
}

export async function requestNotificationPermission(): Promise<NotifyPermission> {
  if (notificationPermission() === 'unsupported') return 'unsupported'
  try {
    return await Notification.requestPermission()
  } catch {
    // 某些环境（iOS 非独立窗口）没有 requestPermission 方法
    return notificationPermission()
  }
}

/** 轻振动：只在支持的设备上生效，静默失败。 */
export function haptic(pattern: number | number[] = 12): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return false
  try {
    return navigator.vibrate(pattern)
  } catch {
    return false
  }
}

function record(title: string, body: string, via: NotifyResult['via']) {
  const win = window as DebugWindow
  win.__nestoryLastNotification = { title, body, at: Date.now(), via }
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function viaServiceWorker(title: string, body: string, tag?: string): Promise<boolean> {
  if (!('serviceWorker' in navigator)) return false
  try {
    const existing = await navigator.serviceWorker.getRegistration()
    if (!existing) return false
    // 刚注册时 worker 可能还在 installing，等它接管页面再发；超时就走兜底
    const registration =
      existing.active ? existing : await Promise.race([navigator.serviceWorker.ready, delay(2500).then(() => null)])
    if (!registration) return false
    await registration.showNotification(title, {
      body,
      tag,
      icon: NOTIFY_ICON,
      data: { url: '/#/reminders' },
    })
    return true
  } catch {
    return false
  }
}

export async function notify(
  title: string,
  body: string,
  options: { tag?: string; vibrate?: boolean } = {},
): Promise<NotifyResult> {
  if (options.vibrate) haptic([16, 60, 16])

  const permission = notificationPermission()
  if (permission !== 'granted') {
    return { ok: false, via: 'none', reason: permission === 'unsupported' ? 'unsupported' : permission }
  }

  if (await viaServiceWorker(title, body, options.tag)) {
    record(title, body, 'service-worker')
    return { ok: true, via: 'service-worker' }
  }

  try {
    const shown = new Notification(title, { body, tag: options.tag, icon: NOTIFY_ICON })
    // 点开通知回到提醒页；页面没在前台时只切回窗口
    shown.onclick = () => {
      window.focus()
      navigate('reminders')
      shown.close()
    }
    record(title, body, 'notification')
    return { ok: true, via: 'notification' }
  } catch (error) {
    return { ok: false, via: 'none', reason: error instanceof Error ? error.message : 'blocked' }
  }
}
