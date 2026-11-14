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
  /** 纪念日记录写下时的生日（yyyy-mm-dd）。生日改了，这条记录就不该再算数。 */
  birthday?: string
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
  /** Avatar sources the family removed from the picker; the default stays. */
  avatarHidden?: string[]
}

/** A short clip that turns a still photo into a "live" photo. */
export type PhotoMotion = {
  /** 后端返回的静态短片地址（演示素材或对象存储 URL） */
  video?: string
  /** IndexedDB media id for uploaded clips (keeps localStorage small) */
  videoId?: string
  durationSec?: number
}

export type Photo = {
  id: string
  src: string
  thumb: string
  at: number
  caption: string
  /** 视觉模型缓存的画面描述；只用于 AI 故事，不展示给用户 */
  visualCaption?: string
  /** 描述生成时间，便于以后判断是否过期 */
  visualAt?: number
  author: string
  /** photo (still, optionally with motion), video (clip with poster); 'live' is legacy */
  kind?: 'photo' | 'live' | 'video'
  motion?: PhotoMotion
  /** @deprecated legacy live clip fields */
  video?: string
  /** @deprecated legacy live clip fields */
  videoId?: string
  /** @deprecated legacy live clip fields */
  durationSec?: number
}

export type Reminder = {
  enabled: boolean
  intervalMinutes: number
  quietNight: boolean
  vibration: boolean
}

/** 删进回收站的照片：保留原 photo 元数据 + 删除时间，恢复时原样放回。 */
export type TrashItem = Photo & { deletedAt: number }

export type FamilyMember = {
  id: string
  name: string
  role: string
  color: string
  permission: 'admin' | 'edit' | 'read'
  /** 账号级头像（媒体地址）；没设置时用 color + 首字兜底 */
  avatarUrl?: string | null
}

export type ArchivedState = {
  feeds: FeedRecord[]
  sleeps: SleepRecord[]
  diapers: DiaperRecord[]
  growths: GrowthRecord[]
  milestones: Milestone[]
  photos: Photo[]
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
  /** 最近删除：只留 7 天，恢复后回到 photos。 */
  trash?: TrashItem[]
  /** 早于当前生日的旧记录：保留可恢复，但不参与任何展示、统计和 AI。 */
  archived?: ArchivedState
  heroPhotoIds: string[]
  reminder: Reminder
  family: FamilyMember[]
  /** 当前登录/使用这台设备的家庭成员 id，由后端会话返回 */
  viewerId: string
  lastSyncedAt: number
  /** false = 新账号还没完成/跳过引导；缺省视为已完成（兼容旧数据） */
  onboarded?: boolean
}
