import type {
  AppState,
  ArchivedState,
  Baby,
  DiaperRecord,
  FeedRecord,
  GrowthRecord,
  Milestone,
  Photo,
  SleepRecord,
} from '../data/types'
import { startOfDay } from './date'

/** 这份 App 里的“出生下界”统一按自然日计算：生日当天全天都算出生后。 */
export function birthdayStart(baby: Baby | null | undefined): number | null {
  const raw = baby?.birthday
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null
  const ts = Date.parse(`${raw}T00:00:00`)
  return Number.isFinite(ts) ? startOfDay(ts) : null
}

export function isBeforeBirth(ts: number, baby: Baby | null | undefined): boolean {
  const birth = birthdayStart(baby)
  return birth != null && Number.isFinite(ts) && startOfDay(ts) < birth
}

export function emptyArchive(): ArchivedState {
  return { feeds: [], sleeps: [], diapers: [], growths: [], milestones: [], photos: [] }
}

type Kind = keyof ArchivedState
type BirthRecord = FeedRecord | SleepRecord | DiaperRecord | GrowthRecord | Milestone | Photo

const KINDS: Kind[] = ['feeds', 'sleeps', 'diapers', 'growths', 'milestones', 'photos']

function timeOf(kind: Kind, item: BirthRecord): number {
  if (kind === 'feeds') return (item as FeedRecord).startedAt
  if (kind === 'sleeps') return (item as SleepRecord).startedAt
  return (item as DiaperRecord | GrowthRecord | Milestone | Photo).at
}

function mergeArchive<T extends { id: string }>(main: T[], archived: T[]): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const item of [...archived, ...main]) {
    if (!item?.id || seen.has(item.id)) continue
    seen.add(item.id)
    out.push(item)
  }
  return out
}

/**
 * 把早于生日的记录从主数组移到 `archived`。
 * 每次生日变更都从「主数组 + archived」重新切分，所以生日改早时旧记录会自动恢复。
 */
export function normalizeBirthState(state: AppState): AppState {
  const archived = state.archived ?? emptyArchive()
  const nextArchive = emptyArchive()
  const next = { ...state, archived: nextArchive } as AppState

  for (const kind of KINDS) {
    const main = (state[kind] ?? []) as BirthRecord[]
    const old = (archived[kind] ?? []) as BirthRecord[]
    const keep: BirthRecord[] = []
    const hide: BirthRecord[] = []
    for (const item of mergeArchive(main, old)) {
      if (isBeforeBirth(timeOf(kind, item), state.baby)) hide.push(item)
      else keep.push(item)
    }
    ;(next[kind] as BirthRecord[]) = keep
    ;(nextArchive[kind] as BirthRecord[]) = hide
  }

  const visibleIds = new Set(next.photos.map((p) => p.id))
  next.heroPhotoIds = (state.heroPhotoIds ?? []).filter((id) => visibleIds.has(id))
  return next
}

export type BirthConflicts = {
  feeds: number
  sleeps: number
  diapers: number
  growths: number
  milestones: number
  photos: number
  total: number
  earliest: number | null
}

export function preBirthConflicts(state: AppState, baby: Baby): BirthConflicts {
  const counts: BirthConflicts = {
    feeds: 0,
    sleeps: 0,
    diapers: 0,
    growths: 0,
    milestones: 0,
    photos: 0,
    total: 0,
    earliest: null,
  }
  for (const kind of KINDS) {
    for (const item of (state[kind] ?? []) as BirthRecord[]) {
      if (!isBeforeBirth(timeOf(kind, item), baby)) continue
      counts[kind] += 1
      const at = timeOf(kind, item)
      if (counts.earliest == null || at < counts.earliest) counts.earliest = at
    }
  }
  counts.total = KINDS.reduce((sum, kind) => sum + counts[kind], 0)
  return counts
}
