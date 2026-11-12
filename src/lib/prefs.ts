import { useCallback, useEffect, useState } from 'react'
import { FONT_OPTIONS, STORAGE_KEYS } from '../data/config'

export type FontSize = 'small' | 'normal' | 'large' | 'xlarge'

export type Prefs = {
  fontSize: FontSize
  reduceMotion: boolean
  analytics: boolean
}

const KEY = STORAGE_KEYS.prefs

export const FONT_SCALE = Object.fromEntries(
  FONT_OPTIONS.map((option) => [option.key, option.scale]),
) as Record<FontSize, number>

export const FONT_LABEL = Object.fromEntries(
  FONT_OPTIONS.map((option) => [option.key, option.label]),
) as Record<FontSize, string>

const DEFAULTS: Prefs = { fontSize: 'normal', reduceMotion: false, analytics: false }

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return DEFAULTS
    const parsed = JSON.parse(raw) as Partial<Prefs>
    return {
      fontSize: parsed.fontSize && parsed.fontSize in FONT_SCALE ? parsed.fontSize : 'normal',
      reduceMotion: Boolean(parsed.reduceMotion),
      analytics: Boolean(parsed.analytics),
    }
  } catch {
    return DEFAULTS
  }
}

export function applyPrefs(prefs: Prefs) {
  const root = document.documentElement
  root.style.setProperty('--type-scale', String(FONT_SCALE[prefs.fontSize]))
  root.dataset.fontSize = prefs.fontSize
  root.dataset.reduceMotion = prefs.reduceMotion ? 'true' : 'false'
}

export function usePrefs() {
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs)

  useEffect(() => {
    applyPrefs(prefs)
    try {
      localStorage.setItem(KEY, JSON.stringify(prefs))
    } catch {
      /* 存储不可用时只应用当前会话 */
    }
  }, [prefs])

  const update = useCallback((patch: Partial<Prefs>) => {
    setPrefs((prev) => ({ ...prev, ...patch }))
  }, [])

  return { prefs, update }
}
