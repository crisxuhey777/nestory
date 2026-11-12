/**
 * 全局按钮按压动效。
 *
 * 只做视觉反馈，不拦截点击、不改变事件顺序：
 * - pointerdown 时轻微压缩
 * - 松手/键盘触发后回弹，并给有底色的按钮一圈很淡的香槟光
 * - 尊重系统「减少动态效果」与设置里的同选项
 */
const SPRING_MS = 380

function motionAllowed() {
  if (document.documentElement.dataset.reduceMotion === 'true') return false
  return !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

function isDisabled(el: HTMLElement) {
  return (
    (el instanceof HTMLButtonElement && el.disabled) ||
    el.getAttribute('aria-disabled') === 'true'
  )
}

let pressed: HTMLElement | null = null
let startX = 0
let startY = 0
let pointerId: number | null = null

function cancel() {
  if (pressed) pressed.classList.remove('is-pressing')
  pressed = null
  pointerId = null
}

function release(event: PointerEvent) {
  if (!pressed) return
  if (pointerId !== null && event.pointerId !== pointerId) return
  const moved = Math.hypot(event.clientX - startX, event.clientY - startY)
  const el = pressed
  pressed = null
  pointerId = null
  el.classList.remove('is-pressing')
  if (moved > 10 || !motionAllowed()) return
  el.classList.remove('is-tapped')
  // 强制重排，让连续点击也能重新播放
  void el.offsetWidth
  el.classList.add('is-tapped')
  window.setTimeout(() => el.classList.remove('is-tapped'), SPRING_MS)
}

export function installTapFeedback() {
  if (typeof window === 'undefined') return
  const flag = window as Window & { __nestoryTapInstalled?: boolean }
  if (flag.__nestoryTapInstalled) return
  flag.__nestoryTapInstalled = true

  document.addEventListener(
    'pointerdown',
    (event) => {
      if (!motionAllowed() || event.button !== 0) return
      const target = (event.target as Element | null)?.closest?.(
        'button, [role="button"]',
      ) as HTMLElement | null
      if (!target || isDisabled(target)) return
      pressed = target
      pointerId = event.pointerId
      startX = event.clientX
      startY = event.clientY
      target.classList.add('is-pressing')
    },
    { passive: true },
  )

  document.addEventListener('pointerup', release, { passive: true })
  document.addEventListener('pointercancel', cancel, { passive: true })

  // 键盘 Enter / Space 触发的 click 没有 pointerdown，同样给一次回弹
  document.addEventListener('click', (event) => {
    if (event.detail !== 0 || !motionAllowed()) return
    const target = (event.target as Element | null)?.closest?.(
      'button, [role="button"]',
    ) as HTMLElement | null
    if (!target || isDisabled(target)) return
    target.classList.remove('is-tapped')
    void target.offsetWidth
    target.classList.add('is-tapped')
    window.setTimeout(() => target.classList.remove('is-tapped'), SPRING_MS)
  })
}
