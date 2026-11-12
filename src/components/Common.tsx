import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../brand/icons'
import { goBack, navigate } from '../lib/route'
import type { Route } from '../lib/route'
import { useStore } from '../data/store'
import { NAV_TABS } from '../data/config'

export function ScreenHead({
  title,
  sub,
  right,
  back = 'home',
  onBack,
}: {
  title: string
  sub?: string
  right?: ReactNode
  back?: Route
  onBack?: () => void
}) {
  return (
    <header className="screen-head">
      <button
        className="icon-btn icon-btn--plain"
        aria-label="返回"
        onClick={() => (onBack ? onBack() : goBack(back))}
      >
        <Icon name="chevronLeft" size={22} />
      </button>
      <div style={{ textAlign: 'center' }}>
        <h1 className="screen-head__title">{title}</h1>
        {sub ? <span className="screen-head__sub">{sub}</span> : null}
      </div>
      {right ?? <span className="screen-head__spacer" />}
    </header>
  )
}

export function TabHead({
  title,
  en,
  meta,
  right,
}: {
  title: string
  en: string
  meta?: string
  right?: ReactNode
}) {
  return (
    <header className="tab-head">
      <div className="tab-head__text">
        <span className="tab-head__en">{en}</span>
        <h1 className="tab-head__title">{title}</h1>
        {meta ? <p className="tab-head__meta">{meta}</p> : null}
      </div>
      {right ?? <span className="tab-head__spacer" />}
    </header>
  )
}

export function SectionHead({
  title,
  en,
  action,
  onAction,
}: {
  title: string
  en?: string
  action?: string
  onAction?: () => void
}) {
  return (
    <div className="section-head">
      <div className="section-head__main">
        <h2 className="section-head__title">{title}</h2>
        {en ? <span className="section-head__en">{en}</span> : null}
      </div>
      {action ? (
        <button className="section-head__action" onClick={onAction}>
          {action}
          <Icon name="chevronRight" size={12} />
        </button>
      ) : null}
    </div>
  )
}

export function TabBar({ active }: { active: Route }) {
  return (
    <nav className="tabbar" aria-label="主导航">
      {NAV_TABS.map((t) => (
        <button
          key={t.route}
          className={`tab${active === t.route ? ' tab--on' : ''}`}
          onClick={() => navigate(t.route)}
          aria-current={active === t.route ? 'page' : undefined}
        >
          <span className="tab__dot" />
          <span className="tab__icon">
            <Icon name={t.icon} size={22} />
          </span>
          <span className="tab__label">{t.label}</span>
        </button>
      ))}
    </nav>
  )
}

export function Toasts() {
  const { toasts, dismiss } = useStore()
  if (!toasts.length) return null
  return createPortal(
    <div className="toast-layer" aria-live="polite">
      {toasts.map((t) => (
        <button key={t.id} className="toast" onClick={() => dismiss(t.id)}>
          <Icon name="check" size={14} />
          {t.text}
        </button>
      ))}
    </div>,
    document.body,
  )
}

/** 生长曲线：平滑折线 + 淡色面积，不做装饰性网格 */
export function Sparkline({
  points,
  height = 104,
  label,
}: {
  points: { x: number; y: number }[]
  height?: number
  label?: string
}) {
  const W = 320
  const H = height
  const padX = 6
  const padY = 14
  if (points.length === 0) return null
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const sx = (x: number) => padX + ((x - minX) / Math.max(1, maxX - minX)) * (W - padX * 2)
  const sy = (y: number) =>
    H - padY - ((y - minY) / Math.max(0.0001, maxY - minY)) * (H - padY * 2)

  const pts = points.map((p) => [sx(p.x), sy(p.y)] as const)
  let d = `M ${pts[0][0]} ${pts[0][1]}`
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1]
    const [x1, y1] = pts[i]
    const cx = (x0 + x1) / 2
    d += ` C ${cx} ${y0}, ${cx} ${y1}, ${x1} ${y1}`
  }
  const area = `${d} L ${pts[pts.length - 1][0]} ${H} L ${pts[0][0]} ${H} Z`

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label ?? '趋势'}>
      <path d={area} fill="var(--sage-tint)" />
      <path d={d} fill="none" stroke="var(--forest)" strokeWidth="2" strokeLinecap="round" />
      {pts.map(([x, y], i) => (
        <circle
          key={i}
          cx={x}
          cy={y}
          r={i === pts.length - 1 ? 4 : 2.6}
          fill={i === pts.length - 1 ? 'var(--champagne)' : 'var(--forest)'}
          stroke={i === pts.length - 1 ? 'var(--forest)' : 'none'}
          strokeWidth={i === pts.length - 1 ? 1.4 : 0}
        />
      ))}
    </svg>
  )
}
