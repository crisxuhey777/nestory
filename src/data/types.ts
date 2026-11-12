export type FeedRecord = {
  id: string
  /** epoch ms, the canonical basis for interval statistics */
  startedAt: number
  endedAt?: number
  leftSec: number
  rightSec: number
  bottleMl: number
  formulaMl: number
  note?: string
  author: string
  updatedAt: number
}

export type SleepRecord = {
  id: string
  startedAt: number
  endedAt?: number
  note?: string
}

export type DiaperRecord = {
  id: string
  at: number
  kind: 'wet' | 'dirty' | 'both'
  note?: string
}

export type GrowthRecord = {
  id: string
  at: number
  weightKg?: number
  heightCm?: number
  headCm?: number
}

export type Milestone = {
  id: string
  at: number
  title: string
  note?: string
  kind: 'milestone' | 'anniversary'
}

export type Baby = {
  name: string
  birthday: string // ISO yyyy-mm-dd
  birthTime: string // HH:mm
  gender: 'girl' | 'boy' | ''
  birthWeightKg: number
  birthHeightCm: number
  birthHeadCm: number
  birthplace: string
  avatar: string
}

export type Photo = {
  id: string
  src: string
  thumb: string
  at: number
  caption: string
  author: string
  /** photo (still), live (still + short motion clip), video (clip with poster) */
  kind?: 'photo' | 'live' | 'video'
  /** 后端返回的静态短片地址（演示素材或对象存储 URL） */
  video?: string
  /** IndexedDB media id for uploaded clips (keeps localStorage small) */
  videoId?: string
  durationSec?: number
}

export type Reminder = {
  enabled: boolean
  intervalMinutes: number
  quietNight: boolean
  vibration: boolean
}

export type FamilyMember = {
  id: string
  name: string
  role: string
  color: string
  permission: 'admin' | 'edit' | 'read'
}

export type AppState = {
  version: number
  baby: Baby
  feeds: FeedRecord[]
  sleeps: SleepRecord[]
  diapers: DiaperRecord[]
  growths: GrowthRecord[]
  milestones: Milestone[]
  photos: Photo[]
  heroPhotoIds: string[]
  reminder: Reminder
  family: FamilyMember[]
  /** 当前登录/使用这台设备的家庭成员 id，由后端会话返回 */
  viewerId: string
  lastSyncedAt: number
  /** false = 新账号还没完成/跳过引导；缺省视为已完成（兼容旧数据） */
  onboarded?: boolean
}
