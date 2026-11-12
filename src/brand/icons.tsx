import type { CSSProperties, ReactNode } from 'react'

/**
 * Nestory icon system — Filled Duotone / Solid Rounded.
 * No outline iconography: every glyph is built from solid, rounded forms.
 * Primary mass = forest green (currentColor); small accent = champagne gold.
 */
export type IconName =
  | 'home'
  | 'growth'
  | 'album'
  | 'profile'
  | 'feed'
  | 'formula'
  | 'timer'
  | 'sleep'
  | 'diaper'
  | 'weight'
  | 'camera'
  | 'video'
  | 'live'
  | 'clock'
  | 'bell'
  | 'plus'
  | 'chevronLeft'
  | 'chevronRight'
  | 'edit'
  | 'trash'
  | 'calendar'
  | 'sparkle'
  | 'check'
  | 'close'
  | 'pause'
  | 'play'
  | 'family'
  | 'shield'
  | 'sync'
  | 'settings'
  | 'sun'
  | 'heart'
  | 'leaf'
  | 'book'
  | 'drop'
  | 'arrowRight'
  | 'arrowUp'
  | 'milk'

const A = 'var(--icon-accent, #D7C6A4)'

const shapes: Record<IconName, ReactNode> = {
  home: (
    <>
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M13 2.5a1.7 1.7 0 0 0-2 0L3.4 8.3A3.6 3.6 0 0 0 2 11.2v7.6a3 3 0 0 0 3 3h14a3 3 0 0 0 3-3v-7.6c0-1.1-.5-2.1-1.4-2.9L13 2.5Zm-1 13.9c.9 0 1.6.7 1.6 1.6v3.8h-3.2V18c0-.9.7-1.6 1.6-1.6Z"
      />
      <circle cx="16.6" cy="12.6" r="2.1" fill={A} />
    </>
  ),
  growth: (
    <>
      <rect x="10.7" y="6.6" width="2.6" height="14.4" rx="1.3" fill="currentColor" />
      <ellipse cx="7.3" cy="11.3" rx="4.2" ry="2.3" transform="rotate(-34 7.3 11.3)" fill="currentColor" />
      <ellipse cx="16.7" cy="9.2" rx="4.2" ry="2.3" transform="rotate(30 16.7 9.2)" fill="currentColor" />
      <circle cx="12" cy="4.6" r="2.1" fill={A} />
    </>
  ),
  album: (
    <>
      <rect x="8.6" y="2.6" width="12.2" height="9.6" rx="3" fill={A} />
      <path
        fill="currentColor"
        d="M3 10.8c0-2.1 1.7-3.8 3.8-3.8h10.4c2.1 0 3.8 1.7 3.8 3.8v6.4c0 2.1-1.7 3.8-3.8 3.8H6.8c-2.1 0-3.8-1.7-3.8-3.8v-6.4Z"
      />
      <path d="M3 18.6c1.3-2.4 3.4-3.8 5.8-3.8 2.6 0 4.9 1.7 6 4.2H20v1.8H3v-2.2Z" fill={A} opacity="0.9" />
      <circle cx="15.9" cy="11.6" r="2" fill={A} />
    </>
  ),
  profile: (
    <>
      <circle cx="12" cy="7.9" r="4.3" fill="currentColor" />
      <path
        d="M12 13.4c-4.6 0-8 2.6-8 6.1 0 1.3.9 1.9 2 1.9h12c1.1 0 2-.6 2-1.9 0-3.5-3.4-6.1-8-6.1Z"
        fill="currentColor"
      />
    </>
  ),
  feed: (
    <>
      <rect x="7.5" y="7.4" width="9" height="13.4" rx="3.6" fill="currentColor" />
      <rect x="9.3" y="4.4" width="5.4" height="3.8" rx="1.5" fill="currentColor" />
      <rect x="8.6" y="2.3" width="6.8" height="2.8" rx="1.4" fill={A} />
      <path d="M8.2 13.6h7.6v3.4c0 1.8-1.7 3.2-3.8 3.2s-3.8-1.4-3.8-3.2v-3.4Z" fill={A} />
    </>
  ),
  formula: (
    <>
      <rect x="7.5" y="8.2" width="9" height="12.6" rx="3.6" fill="currentColor" />
      <rect x="9.3" y="5.4" width="5.4" height="3.4" rx="1.4" fill="currentColor" />
      <path d="M8.2 13.8h7.6v3c0 1.8-1.7 3.2-3.8 3.2s-3.8-1.4-3.8-3.2v-3Z" fill={A} opacity="0.55" />
      <path d="M15.4 6.2c0-2.4 1.6-4.1 4.2-4.6.4 2.7-.8 4.6-3.2 5.2-.6.1-1-.1-1-.6Z" fill={A} />
    </>
  ),
  timer: (
    <>
      <circle cx="12" cy="13.2" r="8.6" fill="currentColor" />
      <path d="M9 2.4h6c.8 0 1.4.6 1.4 1.4S15.8 5.2 15 5.2H9c-.8 0-1.4-.6-1.4-1.4S8.2 2.4 9 2.4Z" fill={A} />
      <path
        d="M12.9 8.2c0-.5-.4-.9-.9-.9s-.9.4-.9.9v5.1c0 .4.2.7.5.9l3 1.7c.4.3 1 .1 1.2-.3.3-.4.1-1-.3-1.2l-2.6-1.5V8.2Z"
        fill={A}
      />
    </>
  ),
  sleep: (
    <>
      <path d="M20.6 14.9A8.9 8.9 0 0 1 9.1 3.4 9.5 9.5 0 1 0 20.6 14.9Z" fill="currentColor" />
      <path
        d="M17.9 3.2c.2 1.7.9 2.4 2.6 2.6-1.7.2-2.4.9-2.6 2.6-.2-1.7-.9-2.4-2.6-2.6 1.7-.2 2.4-.9 2.6-2.6Z"
        fill={A}
      />
    </>
  ),
  diaper: (
    <>
      <rect x="3.8" y="4.4" width="16.4" height="3.6" rx="1.8" fill={A} />
      <path d="M4 9.4h16c.4 5-2.9 9.8-8 9.8S3.6 14.4 4 9.4Z" fill="currentColor" />
    </>
  ),
  weight: (
    <>
      <rect x="2.9" y="4.4" width="18.2" height="15.2" rx="4.8" fill="currentColor" />
      <circle cx="12" cy="11.8" r="4.4" fill={A} />
      <path d="M12 11.8 14.7 9.2" stroke="#304B3B" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="12" cy="11.8" r="1.3" fill="#304B3B" />
    </>
  ),
  camera: (
    <>
      <path d="M8.1 6.4l.9-1.8c.5-1 1.5-1.6 2.6-1.6h.8c1.1 0 2.1.6 2.6 1.6l.9 1.8H8.1Z" fill="currentColor" />
      <rect x="2.4" y="6.2" width="19.2" height="14.2" rx="4.6" fill="currentColor" />
      <circle cx="12" cy="13.2" r="4.6" fill={A} />
      <circle cx="12" cy="13.2" r="2.4" fill="#304B3B" />
      <circle cx="18.4" cy="9.5" r="1.1" fill={A} />
    </>
  ),
  video: (
    <>
      <rect x="2.4" y="6.6" width="13.8" height="12.4" rx="4.4" fill="currentColor" />
      <path d="M17.4 11.4l3.2-2c1-.6 2.2.1 2.2 1.3v4.6c0 1.2-1.2 1.9-2.2 1.3l-3.2-2v-3.2Z" fill={A} />
      <circle cx="9.3" cy="12.8" r="3.2" fill={A} />
      <circle cx="9.3" cy="12.8" r="1.5" fill="#304B3B" />
    </>
  ),
  live: (
    <>
      <path
        fillRule="evenodd"
        d="M12 2.6a9.4 9.4 0 1 0 0 18.8 9.4 9.4 0 0 0 0-18.8Zm0 3.2a6.2 6.2 0 1 1 0 12.4 6.2 6.2 0 0 1 0-12.4Z"
        fill="currentColor"
      />
      <circle cx="12" cy="12" r="2.6" fill={A} />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9.4" fill="currentColor" />
      <path
        d="M12 6.2c.9 0 1.6.7 1.6 1.6v3.4l2.2 1.5c.7.5.9 1.5.4 2.2-.5.7-1.5.9-2.2.4l-2.8-1.9c-.5-.3-.8-.9-.8-1.5V7.8c0-.9.7-1.6 1.6-1.6Z"
        fill={A}
      />
    </>
  ),
  bell: (
    <>
      <path
        d="M12 2.8c-4 0-6.8 3-6.8 7.2v2.5c0 1-.5 2-1.4 3-.7 1-.1 2.3 1.1 2.3h14.2c1.2 0 1.8-1.3 1.1-2.3-.9-1-1.4-2-1.4-3V10c0-4.2-2.8-7.2-6.8-7.2Z"
        fill="currentColor"
      />
      <circle cx="12" cy="20.1" r="2.2" fill={A} />
    </>
  ),
  plus: (
    <>
      <rect x="10.7" y="3.2" width="2.6" height="17.6" rx="1.3" fill="currentColor" />
      <rect x="3.2" y="10.7" width="17.6" height="2.6" rx="1.3" fill="currentColor" />
    </>
  ),
  chevronLeft: (
    <path
      d="M14.8 4.2c.9-.8 2.2-.7 3 .2.7.9.6 2.2-.3 2.9L12.3 12l5.2 4.7c.9.7 1 2 .3 2.9-.8.9-2.1 1-3 .2l-6.9-6.1a2 2 0 0 1 0-3l6.9-6.5Z"
      fill="currentColor"
    />
  ),
  chevronRight: (
    <path
      d="M9.2 4.2c-.9-.8-2.2-.7-3 .2-.7.9-.6 2.2.3 2.9L11.7 12l-5.2 4.7c-.9.7-1 2-.3 2.9.8.9 2.1 1 3 .2l6.9-6.1a2 2 0 0 0 0-3L9.2 4.2Z"
      fill="currentColor"
    />
  ),
  edit: (
    <>
      <path
        d="M16.3 2.9a3.3 3.3 0 0 1 4.6 4.6l-9.7 9.7a3 3 0 0 1-1.3.7l-3.7 1c-.9.2-1.7-.6-1.5-1.5l1-3.7a3 3 0 0 1 .7-1.3l9.9-9.5Z"
        fill="currentColor"
      />
      <path d="m4.6 19.8 2.6-.7-1.9-1.9-.7 2.6Z" fill={A} />
    </>
  ),
  trash: (
    <>
      <path
        d="M4.7 6.8h14.6l-.9 11.8c-.2 2.2-2 3.9-4.2 3.9H9.8c-2.2 0-4-1.7-4.2-3.9L4.7 6.8Z"
        fill="currentColor"
      />
      <rect x="3" y="4" width="18" height="2.8" rx="1.4" fill={A} />
      <path d="M9 3.2V2.6C9 1.7 9.7 1 10.6 1h2.8c.9 0 1.6.7 1.6 1.6v.6H9Z" fill="currentColor" />
    </>
  ),
  calendar: (
    <>
      <rect x="2.8" y="4.2" width="18.4" height="16.8" rx="4.4" fill="currentColor" />
      <path d="M2.8 8.6c0-2.4 2-4.4 4.4-4.4h9.6c2.4 0 4.4 2 4.4 4.4v1.2H2.8V8.6Z" fill={A} />
      <rect x="6.2" y="2.2" width="2.6" height="4.2" rx="1.3" fill="currentColor" />
      <rect x="15.2" y="2.2" width="2.6" height="4.2" rx="1.3" fill="currentColor" />
      <rect x="6.4" y="12.4" width="3" height="2.2" rx="1.1" fill={A} />
      <rect x="10.5" y="12.4" width="3" height="2.2" rx="1.1" fill={A} opacity="0.55" />
      <rect x="14.6" y="12.4" width="3" height="2.2" rx="1.1" fill={A} opacity="0.55" />
      <rect x="6.4" y="16.4" width="3" height="2.2" rx="1.1" fill={A} opacity="0.55" />
    </>
  ),
  sparkle: (
    <>
      <path
        d="M11.4 2.9c.3-1.1 1.9-1.1 2.2 0l1.2 4.3c.3 1 1.1 1.8 2.1 2.1l4.3 1.2c1.1.3 1.1 1.9 0 2.2l-4.3 1.2c-1 .3-1.8 1.1-2.1 2.1l-1.2 4.3c-.3 1.1-1.9 1.1-2.2 0l-1.2-4.3c-.3-1-1.1-1.8-2.1-2.1l-4.3-1.2c-1.1-.3-1.1-1.9 0-2.2l4.3-1.2c1-.3 1.8-1.1 2.1-2.1l1.2-4.3Z"
        fill="currentColor"
      />
      <path d="M5.4 18.1c.1-.5.9-.5 1 0l.4 1.5 1.5.4c.5.1.5.9 0 1l-1.5.4-.4 1.5c-.1.5-.9.5-1 0l-.4-1.5-1.5-.4c-.5-.1-.5-.9 0-1l1.5-.4.4-1.5Z" fill={A} />
    </>
  ),
  check: (
    <path
      d="M9.6 18.6c-.8 0-1.5-.3-2-.9L3.8 13.4c-.9-1-.9-2.5.1-3.3.9-.8 2.3-.7 3.2.2l2.5 2.8 7.3-8.2c.8-1 2.2-1.1 3.2-.3 1 .8 1.1 2.2.3 3.2l-9.3 10.5c-.4.5-1 .8-1.5.8Z"
      fill="currentColor"
    />
  ),
  close: (
    <>
      <rect x="10.6" y="2.2" width="2.8" height="19.6" rx="1.4" transform="rotate(45 12 12)" fill="currentColor" />
      <rect x="10.6" y="2.2" width="2.8" height="19.6" rx="1.4" transform="rotate(-45 12 12)" fill="currentColor" />
    </>
  ),
  pause: (
    <>
      <rect x="5.8" y="3.6" width="4.2" height="16.8" rx="2.1" fill="currentColor" />
      <rect x="14" y="3.6" width="4.2" height="16.8" rx="2.1" fill="currentColor" />
    </>
  ),
  play: (
    <path d="M8.4 5.4c0-1.7 1.8-2.7 3.2-1.9l9.5 5.5c1.4.8 1.4 2.9 0 3.7l-9.5 5.5c-1.4.8-3.2-.2-3.2-1.9V5.4Z" fill="currentColor" />
  ),
  family: (
    <>
      <circle cx="14.6" cy="6.4" r="3.6" fill="currentColor" />
      <path d="M14.6 11.4c-3.6 0-6.3 2.2-6.3 5.1 0 1.2.8 1.7 1.8 1.7h9c1 0 1.8-.5 1.8-1.7 0-2.9-2.7-5.1-6.3-5.1Z" fill="currentColor" />
      <circle cx="7.2" cy="10.6" r="2.6" fill={A} />
      <path d="M7.2 14.2c-2.6 0-4.4 1.6-4.4 3.7 0 .9.5 1.3 1.3 1.3h5.4c.4-1.9 1.5-3.5 3-4.5-1.3-.4-2.7-.5-5.3-.5Z" fill={A} />
    </>
  ),
  shield: (
    <>
      <path d="M11.1 2.6a2.4 2.4 0 0 1 1.8 0l6.6 2.5c.9.4 1.5 1.2 1.5 2.2v5c0 4.9-3.3 9.2-8.1 10.5a1.7 1.7 0 0 1-.8 0C7.3 21.5 4 17.2 4 12.3V7.3c0-1 .6-1.8 1.5-2.2l5.6-2.5Z" fill="currentColor" />
      <path d="M15.8 8.4c.6.6.6 1.5 0 2.1l-4 4.1c-.6.6-1.5.6-2.1 0l-1.9-2c-.6-.6-.6-1.5 0-2.1.6-.6 1.5-.6 2.1 0l.8.9 3-3c.6-.6 1.5-.6 2.1 0Z" fill={A} />
    </>
  ),
  sync: (
    <>
      <path d="M12 2.6c-4.4 0-8.1 3.1-8.9 7.3-.2 1 .6 1.9 1.6 1.9.8 0 1.4-.5 1.6-1.3A5.8 5.8 0 0 1 12 6.2c1.3 0 2.6.5 3.5 1.3l-.8.8c-.7.7-.2 1.8.7 1.8h4c.6 0 1-.4 1-1v-4c0-.9-1.1-1.4-1.8-.7l-.9.9A8.6 8.6 0 0 0 12 2.6Z" fill="currentColor" />
      <path d="M12 21.4c4.4 0 8.1-3.1 8.9-7.3.2-1-.6-1.9-1.6-1.9-.8 0-1.4.5-1.6 1.3a5.8 5.8 0 0 1-9.3 4.3l.8-.8c.7-.7.2-1.8-.7-1.8h-4c-.6 0-1 .4-1 1v4c0 .9 1.1 1.4 1.8.7l.9-.9c1.4 1 3.2 1.4 5.8 1.4Z" fill={A} />
    </>
  ),
  settings: (
    <>
      <rect x="2.8" y="4.4" width="18.4" height="2.6" rx="1.3" fill="currentColor" />
      <rect x="2.8" y="10.7" width="18.4" height="2.6" rx="1.3" fill="currentColor" />
      <rect x="2.8" y="17" width="18.4" height="2.6" rx="1.3" fill="currentColor" />
      <circle cx="16.4" cy="5.7" r="2.7" fill={A} stroke="#F9F7F1" strokeWidth="1.4" />
      <circle cx="8" cy="12" r="2.7" fill={A} stroke="#F9F7F1" strokeWidth="1.4" />
      <circle cx="14.4" cy="18.3" r="2.7" fill={A} stroke="#F9F7F1" strokeWidth="1.4" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="5" fill="currentColor" />
      {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => (
        <rect key={deg} x="11.2" y="0.9" width="1.6" height="3.4" rx="0.8" fill={A} transform={`rotate(${deg} 12 12)`} />
      ))}
    </>
  ),
  heart: (
    <path
      d="M12 20.9c-.5 0-1-.2-1.4-.5C6.2 17 2.9 13.8 2.9 9.8c0-3.5 2.6-6 5.9-6 1.5 0 2.8.6 3.9 1.9C13.8 4.4 15.1 3.8 16.6 3.8c3.3 0 5.9 2.5 5.9 6 0 4-3.3 7.2-7.7 10.6-.4.3-.9.5-1.4.5Z"
      fill="currentColor"
    />
  ),
  leaf: (
    <>
      <path d="M20.6 3.9c-6.6-.5-12.6 1.5-15.8 5.4-3 3.7-2.1 8.3.4 10.5 2.2 2 6.6 2.6 9.8-.8 3.8-4 3.5-9.4 5.6-15.1Z" fill="currentColor" />
      <path d="M6.4 20.9c-.5.5-1.4.5-1.9 0-.5-.5-.5-1.4 0-1.9l4.2-4.2c.4-.4 1.1-.4 1.5 0 .4.4.4 1.1 0 1.5l-3.8 4.6Z" fill={A} />
    </>
  ),
  book: (
    <>
      <path d="M3.4 6.2c0-1.9 1.5-3.4 3.4-3.4h10.4c1.9 0 3.4 1.5 3.4 3.4v12c0 1.9-1.5 3.4-3.4 3.4H6.8c-1.9 0-3.4-1.5-3.4-3.4V6.2Z" fill="currentColor" />
      <path d="M8 6.4c.7 0 1.2.5 1.2 1.2v8.6c0 .7-.5 1.2-1.2 1.2s-1.2-.5-1.2-1.2V7.6c0-.7.5-1.2 1.2-1.2Z" fill={A} />
    </>
  ),
  drop: (
    <path d="M12 2.4c3.2 4.3 6.8 8.4 6.8 12.2 0 3.9-3 6.9-6.8 6.9s-6.8-3-6.8-6.9c0-3.8 3.6-7.9 6.8-12.2Z" fill="currentColor" />
  ),
  arrowRight: (
    <path d="M13.1 4.3c-.9-.9-2.4-.8-3.2.1-.8.9-.7 2.3.2 3.1l2.9 2.6H4.6c-1.2 0-2.2 1-2.2 2.2s1 2.2 2.2 2.2h8.4l-2.9 2.6c-.9.8-1 2.2-.2 3.1.8.9 2.3 1 3.2.1l6.5-5.9c1-.9 1-2.4 0-3.3l-6.5-6.8Z" fill="currentColor" />
  ),
  arrowUp: (
    <path d="M4.3 10.9c-.9-.9-.8-2.4.1-3.2.9-.8 2.3-.7 3.1.2l2.6 2.9V4.6c0-1.2 1-2.2 2.2-2.2s2.2 1 2.2 2.2v6.2l2.6-2.9c.8-.9 2.2-1 3.1-.2.9.8 1 2.3.1 3.2l-5.9 6.5c-.9 1-2.4 1-3.3 0l-6.8-6.5Z" fill="currentColor" />
  ),
  milk: (
    <>
      <path d="M7.4 8.6h9.2v10.2c0 1.8-1.5 3.2-3.3 3.2h-2.6c-1.8 0-3.3-1.4-3.3-3.2V8.6Z" fill="currentColor" />
      <path d="M8.8 7.4 9.9 2.4h4.2l1.1 5H8.8Z" fill={A} />
      <path d="M8 12.2h8v1.8H8z" fill="#F9F7F1" opacity="0.5" />
    </>
  ),
}

export function Icon({
  name,
  size = 24,
  accent,
  className,
  style,
  title,
}: {
  name: IconName
  size?: number
  accent?: string
  className?: string
  style?: CSSProperties
  title?: string
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      style={{ ['--icon-accent' as string]: accent, ...style }}
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
    >
      {title ? <title>{title}</title> : null}
      {shapes[name]}
    </svg>
  )
}
