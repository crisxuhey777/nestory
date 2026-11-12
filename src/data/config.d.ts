import type { IconName } from '../brand/icons'

export type NavRoute = 'home' | 'feed' | 'growth' | 'album' | 'profile' | 'reminders' | 'about' | 'settings' | 'record'
export type FeedMethodKey = 'breast' | 'bottle' | 'formula'
export type PermissionKey = 'admin' | 'edit' | 'read'
export type FontKey = 'small' | 'normal' | 'large' | 'xlarge'
export type MediaMode = 'photo' | 'video' | 'live'
export type MediaTrigger =
  | 'photoLibrary'
  | 'photoCamera'
  | 'videoLibrary'
  | 'videoCamera'
  | 'liveLibrary'
  | 'liveCamera'
export type QuickTarget = 'feed' | 'sleep' | 'diaper' | 'growth'

export const APP: {
  name: string
  version: string
  year: number
  tagline: string
  taglineZh: string
}

export const API: {
  state: string
  dailyQuote: string
  aiSummary: string
  aiAnalysis: string
  aiStory: string
}

export const STORAGE_KEYS: {
  state: string
  prefs: string
  mediaDb: string
}

export const NAV_TABS: readonly {
  route: NavRoute
  label: string
  icon: IconName
}[]

export const QUICK_ACTIONS: readonly {
  key: string
  label: string
  icon: IconName
  target: QuickTarget
}[]

export const HERO: {
  maxPhotos: number
  intervalMs: number
  pauseMs: number
  quote: string
  brandTag: string
}

export const HOME: {
  recentPhotos: number
  milestones: number
}

export const FEED_METHODS: readonly {
  key: FeedMethodKey
  label: string
  icon: IconName
}[]

export const FEED_PRESETS: readonly number[]

export const FEED_DEFAULTS: {
  bottleMl: number
  formulaMl: number
}

export const REMINDER_INTERVALS: readonly number[]

export const FONT_OPTIONS: readonly {
  key: FontKey
  label: string
  scale: number
  sample: number
}[]

export const PERMISSIONS: readonly {
  key: PermissionKey
  short: string
  label: string
  desc: string
}[]

export const MEDIA_LIMITS: {
  videoMaxMB: number
  photoMaxEdge: number
  photoQuality: number
  posterMaxEdge: number
  posterQuality: number
}

export const MEDIA_GROUPS: readonly {
  key: string
  label: string
  options: readonly {
    key: string
    trigger: MediaTrigger
    icon: IconName
    tone: 'default' | 'live'
    title: string
    desc: string
    limit?: 'videoMaxMB'
    mode: MediaMode
  }[]
}[]

export const PROFILE_MENU: readonly {
  key: 'settings' | 'reminders' | 'share' | 'backup' | 'privacy' | 'about'
  icon: IconName
  title: string
  sub: string
}[]

export const NOTIFICATION_LABELS: Record<
  string,
  { text: string; hint: string; action: string }
>
