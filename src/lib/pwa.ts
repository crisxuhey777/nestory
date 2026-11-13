/**
 * PWA 注册：`public/manifest.webmanifest` 负责安装信息，`public/sw.js` 负责
 * 系统通知点击与安装资格。开发环境默认不注册，避免旧 SW 干扰热更新；
 * 需要验证时在地址后加 `?sw=1`。
 */
export const SERVICE_WORKER_PATH = '/sw.js'

export function serviceWorkerSupported(): boolean {
  return typeof navigator !== 'undefined' && 'serviceWorker' in navigator
}

export function registerServiceWorker(): void {
  if (!serviceWorkerSupported()) return
  const forced = new URLSearchParams(window.location.search).has('sw')
  if (!import.meta.env.PROD && !forced) return

  const start = () => {
    navigator.serviceWorker.register(SERVICE_WORKER_PATH).catch(() => {
      // 注册失败不影响主流程：提醒会退回应用内提示
    })
  }
  if (document.readyState === 'complete') start()
  else window.addEventListener('load', start, { once: true })
}

/** 是否已经「安装」到桌面（独立窗口打开）。 */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  const ios = (window.navigator as Navigator & { standalone?: boolean }).standalone
  return window.matchMedia?.('(display-mode: standalone)').matches === true || ios === true
}
