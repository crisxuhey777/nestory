import type { CSSProperties } from 'react'

type Tone = 'forest' | 'light' | 'mono' | 'champagne'

const TONES: Record<Tone, { bowl: string; egg: string; leaf: string; shade: string; vein: string }> = {
  forest: { bowl: '#304B3B', egg: '#D7C6A4', leaf: '#B8C3B1', shade: '#C3AD85', vein: '#304B3B' },
  light: { bowl: '#F9F7F1', egg: '#D7C6A4', leaf: '#B8C3B1', shade: '#C3AD85', vein: '#304B3B' },
  mono: { bowl: '#304B3B', egg: '#304B3B', leaf: '#304B3B', shade: '#304B3B', vein: '#F9F7F1' },
  champagne: { bowl: '#D7C6A4', egg: '#F9F7F1', leaf: '#D7C6A4', shade: '#D7C6A4', vein: '#304B3B' },
}

/**
 * Nestory mark — a nest cradling an egg, with a sprouting leaf.
 * Geometry is shared with public/brand/mark.svg and the app icon (64 unit grid).
 */
export function NestoryMark({
  size = 32,
  tone = 'forest',
  className,
  style,
}: {
  size?: number
  tone?: Tone
  className?: string
  style?: CSSProperties
}) {
  const c = TONES[tone]
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      className={className}
      style={style}
      role="img"
      aria-label="Nestory"
    >
      <path
        d="M32 9.6c6.4 0 13.2 7.4 13.2 17.6 0 7.4-5.9 13-13.2 13s-13.2-5.6-13.2-13C18.8 17 25.6 9.6 32 9.6Z"
        fill={c.egg}
      />
      {tone !== 'mono' && (
        <path
          d="M19.6 29.8c1.4 6 6.4 10.4 12.4 10.4s11-4.4 12.4-10.4c0 4-4.6 7.4-12.4 7.4s-12.4-3.4-12.4-7.4Z"
          fill={c.shade}
          opacity="0.42"
        />
      )}
      <path
        d="M6.2 31.2c0-1.5 1.4-2.2 2.8-1.7C16.4 32.2 24 33.8 32 33.8s15.6-1.6 23-4.3c1.4-.5 2.8.2 2.8 1.7 0 0-1.2 11.2-9.8 18-4.4 3.5-10 5.8-16 5.8s-11.6-2.3-16-5.8C7.4 42.4 6.2 31.2 6.2 31.2Z"
        fill={c.bowl}
      />
      <circle cx="6.6" cy="30.9" r="1.6" fill={c.bowl} />
      <circle cx="57.4" cy="30.9" r="1.6" fill={c.bowl} />
      <path
        d="M47.5 31.6C47 24 50.6 16.2 57.4 12.4c1.4-.8 2.8.2 2.4 2-1.4 9-5.8 15.4-12.3 17.2Z"
        fill={c.leaf}
      />
      <path
        d="M50.2 29.2c2-4.2 4.4-7.4 7.6-10.2"
        stroke={c.vein}
        strokeWidth="0.9"
        strokeLinecap="round"
        opacity="0.45"
      />
    </svg>
  )
}

export function NestoryWordmark({
  size = 22,
  color = 'var(--forest)',
  className,
  style,
}: {
  size?: number
  color?: string
  className?: string
  style?: CSSProperties
}) {
  return (
    <span
      className={className}
      style={{
        fontFamily: 'var(--font-serif)',
        fontWeight: 500,
        fontVariationSettings: '"opsz" 96, "SOFT" 0, "WONK" 0',
        fontSize: size,
        letterSpacing: '-0.008em',
        color,
        lineHeight: 1,
        display: 'inline-block',
        ...style,
      }}
    >
      Nestory
    </span>
  )
}

/** Horizontal lockup: mark + wordmark + optional descriptor. */
export function NestoryLogo({
  tone = 'forest',
  size = 30,
  descriptor = false,
  color,
  className,
  style,
}: {
  tone?: Tone
  size?: number
  descriptor?: boolean
  color?: string
  className?: string
  style?: CSSProperties
}) {
  const ink = color ?? (tone === 'light' ? '#F9F7F1' : 'var(--forest)')
  return (
    <span
      className={className}
      style={{ display: 'inline-flex', alignItems: 'center', gap: size * 0.3, ...style }}
    >
      <NestoryMark size={size} tone={tone} />
      <span style={{ display: 'flex', flexDirection: 'column', gap: Math.max(4, size * 0.16) }}>
        <NestoryWordmark size={size * 0.88} color={ink} />
        {descriptor && (
          <span
            style={{
              fontFamily: 'var(--font-sans)',
              fontSize: Math.max(6, size * 0.21),
              letterSpacing: '0.42em',
              textTransform: 'uppercase',
              color: tone === 'light' ? 'rgba(249,247,241,0.62)' : 'var(--ink-3)',
              lineHeight: 1,
            }}
          >
            Family&nbsp;Stories
          </span>
        )}
      </span>
    </span>
  )
}
