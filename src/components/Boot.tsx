import type { CSSProperties } from 'react'

const wrap: CSSProperties = {
  minHeight: '100vh',
  display: 'grid',
  placeItems: 'center',
  padding: 24,
  background: 'var(--ivory)',
  color: 'var(--ink)',
}

const nest: CSSProperties = {
  width: 64,
  height: 64,
  borderRadius: '50%',
  border: '1px solid var(--line-strong)',
  background: 'var(--ivory-raised)',
  display: 'grid',
  placeItems: 'center',
  boxShadow: '0 12px 30px rgba(48, 75, 59, 0.08)',
}

const dot: CSSProperties = {
  width: 5,
  height: 5,
  borderRadius: '50%',
  background: 'var(--forest-soft)',
  animation: 'nestory-dot 1.05s infinite ease-in-out',
}

const button: CSSProperties = {
  marginTop: 4,
  padding: '10px 22px',
  borderRadius: 999,
  border: '1px solid var(--forest)',
  background: 'var(--forest)',
  color: 'var(--ivory)',
  fontSize: 14,
  letterSpacing: '.04em',
  cursor: 'pointer',
}

/**
 * 首屏引导层：后端数据到达之前不渲染任何页面内容。
 * 这样「列表里出现什么」完全由 GET /api/state 决定，不会先闪一帧本地示例数据。
 */
export default function BootScreen({
  status,
  onRetry,
}: {
  status: 'loading' | 'error'
  message?: string
  onRetry?: () => void
}) {
  const loading = status === 'loading'

  return (
    <div style={wrap} role="status" aria-live="polite">
      <style>{`
        @keyframes nestory-dot {
          0%, 80%, 100% { opacity: .25; transform: translateY(0); }
          40% { opacity: 1; transform: translateY(-3px); }
        }
      `}</style>

      <div style={{ display: 'grid', justifyItems: 'center', gap: 18, maxWidth: 340, textAlign: 'center' }}>
        <div style={nest}>
          <span style={{ fontFamily: 'var(--font-serif)', fontSize: 26 }}>N</span>
        </div>

        <div>
          <div style={{ fontFamily: 'var(--font-serif)', fontSize: 22, letterSpacing: '.08em' }}>Nestory</div>
          <div
            style={{
              marginTop: 6,
              fontSize: 11,
              letterSpacing: '.18em',
              textTransform: 'uppercase',
              color: 'var(--ink-3)',
            }}
          >
            Family cloud
          </div>
        </div>

        {loading ? (
          <>
            <div style={{ display: 'flex', gap: 6 }}>
              {[0, 1, 2].map((i) => (
                <span key={i} style={{ ...dot, animationDelay: `${i * 0.14}s` }} />
              ))}
            </div>
            <p style={{ margin: 0, fontSize: 14, color: 'var(--ink-2)' }}>正在读取成长记录…</p>
          </>
        ) : (
          <>
            <p style={{ margin: 0, fontSize: 15 }}>暂时连不上 Nestory</p>

            <p style={{ margin: 0, fontSize: 13, lineHeight: 1.7, color: 'var(--ink-2)' }}>
              检查网络后再试一次，你的记录不会丢失。
            </p>

            <button type="button" style={button} onClick={onRetry ?? (() => undefined)}>
              重新连接
            </button>
          </>
        )}
      </div>
    </div>
  )
}
