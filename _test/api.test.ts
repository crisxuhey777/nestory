import { describe, expect, it } from 'vitest'
import { isAppState } from '../src/data/api'

const base = {
  version: 3,
  baby: { name: '小柚子', birthday: '2026-07-31' },
  feeds: [],
  sleeps: [],
  diapers: [],
  growths: [],
  milestones: [],
  photos: [],
  heroPhotoIds: [],
  reminder: { enabled: false, intervalMinutes: 180, quietNight: true, vibration: true },
  family: [],
  viewerId: 'u1',
  lastSyncedAt: 1,
}

describe('isAppState', () => {
  it('accepts a complete state', () => {
    expect(isAppState(base)).toBe(true)
  })

  it('rejects states missing record collections', () => {
    expect(isAppState({ ...base, sleeps: undefined })).toBe(false)
    expect(isAppState({ ...base, diapers: undefined })).toBe(false)
    expect(isAppState({ ...base, growths: undefined })).toBe(false)
    expect(isAppState({ ...base, milestones: undefined })).toBe(false)
    expect(isAppState({ ...base, family: undefined })).toBe(false)
    expect(isAppState({ ...base, heroPhotoIds: undefined })).toBe(false)
  })

  it('accepts a new account before onboarding sets a birthday', () => {
    expect(isAppState({ ...base, baby: { name: '', birthday: '' } })).toBe(true)
  })

  it('rejects a malformed birthday', () => {
    expect(isAppState({ ...base, baby: { name: '小柚子', birthday: '2026/07/31' } })).toBe(false)
  })

  it('rejects a state without reminder settings', () => {
    expect(isAppState({ ...base, reminder: undefined })).toBe(false)
    expect(isAppState({ ...base, reminder: { enabled: false } })).toBe(false)
  })
})
