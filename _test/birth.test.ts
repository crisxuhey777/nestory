import { describe, expect, it } from 'vitest'
import type { AppState, Baby, Photo } from '../src/data/types'
import { birthdayStart, isBeforeBirth, normalizeBirthState, preBirthConflicts } from '../src/lib/birth'

const baby: Baby = {
  name: '小柚子',
  birthday: '2026-10-21',
  birthTime: '',
  gender: 'girl',
  birthWeightKg: 3.2,
  birthHeightCm: 50,
  birthHeadCm: 34,
  birthplace: '杭州',
  avatar: '',
}

function photo(id: string, day: string): Photo {
  return {
    id,
    src: `/api/media/${id}`,
    thumb: `/api/media/${id}`,
    at: new Date(`${day}T12:00:00`).getTime(),
    caption: id,
    author: '妈妈',
  }
}

function state(photos: Photo[], birthday = baby.birthday): AppState {
  return {
    version: 3,
    baby: { ...baby, birthday },
    feeds: [],
    sleeps: [],
    diapers: [],
    growths: [],
    milestones: [],
    photos,
    heroPhotoIds: photos.slice(0, 2).map((p) => p.id),
    reminder: { enabled: false, intervalMinutes: 180, quietNight: true, vibration: true },
    family: [],
    viewerId: '',
    lastSyncedAt: 0,
  }
}

describe('birth lower bound', () => {
  it('uses natural-day boundary, not birth time', () => {
    const birth = birthdayStart(baby)
    expect(birth).not.toBeNull()
    expect(isBeforeBirth(new Date('2026-10-21T00:01:00').getTime(), baby)).toBe(false)
    expect(isBeforeBirth(new Date('2026-10-20T23:59:00').getTime(), baby)).toBe(true)
  })

  it('archives records before birthday and restores them when birthday moves earlier', () => {
    const s = state([photo('before', '2026-07-31'), photo('after', '2026-11-11')])
    const normalized = normalizeBirthState(s)
    expect(normalized.photos.map((p) => p.id)).toEqual(['after'])
    expect(normalized.archived?.photos.map((p) => p.id)).toEqual(['before'])
    expect(normalized.heroPhotoIds).toEqual(['after'])

    const restored = normalizeBirthState({ ...normalized, baby: { ...baby, birthday: '2026-07-31' } })
    expect(restored.photos.map((p) => p.id).sort()).toEqual(['after', 'before'])
    expect(restored.archived?.photos).toHaveLength(0)
  })

  it('counts conflicts when birthday moves later', () => {
    const s = state([photo('july', '2026-07-31'), photo('oct', '2026-10-20'), photo('nov', '2026-11-11')])
    const counts = preBirthConflicts(s, { ...baby, birthday: '2026-10-21' })
    expect(counts.photos).toBe(2)
    expect(counts.total).toBe(2)
    expect(counts.earliest).toBe(s.photos[0].at)
  })
})
