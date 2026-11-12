import { useEffect, useState } from 'react'
import { MEDIA_LIMITS, STORAGE_KEYS } from '../data/config'

/** Downscale and re-encode a picked photo so it fits comfortably in localStorage. */
export async function compressImage(file: File): Promise<string> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = reject
      el.src = url
    })
    const max = MEDIA_LIMITS.photoMaxEdge
    const scale = Math.min(1, max / Math.max(img.width, img.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(img.width * scale)
    canvas.height = Math.round(img.height * scale)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D context is unavailable')
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', MEDIA_LIMITS.photoQuality)
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Uploaded clips live in IndexedDB; localStorage would overflow after one clip. */
const DB_NAME = STORAGE_KEYS.mediaDb
const STORE = 'clips'

let dbPromise: Promise<IDBDatabase> | null = null

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'))
      return
    }
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB failed'))
  })
  return dbPromise
}

export async function putClip(id: string, blob: Blob): Promise<void> {
  const db = await openDB()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(blob, id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('Could not store clip'))
  })
}

export async function getClip(id: string): Promise<Blob | undefined> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const request = tx.objectStore(STORE).get(id)
    request.onsuccess = () => resolve(request.result as Blob | undefined)
    request.onerror = () => reject(request.error ?? new Error('Could not read clip'))
  })
}

const urlCache = new Map<string, string>()

export async function clipURL(id: string): Promise<string> {
  const cached = urlCache.get(id)
  if (cached) return cached
  const blob = await getClip(id)
  if (!blob) return ''
  const url = URL.createObjectURL(blob)
  urlCache.set(id, url)
  return url
}

export type VideoInfo = { poster: string; durationSec: number }

/**
 * Reads a video file, grabs a frame for the poster and reports its duration.
 * Works for Live Photo exports (the .mov half) as well as ordinary clips.
 */
export async function inspectVideo(file: File): Promise<VideoInfo> {
  const url = URL.createObjectURL(file)
  const video = document.createElement('video')
  video.src = url
  video.muted = true
  video.playsInline = true
  video.preload = 'auto'

  try {
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error('video metadata timeout')), 8000)
      video.onloadedmetadata = () => {
        window.clearTimeout(timer)
        resolve()
      }
      video.onerror = () => {
        window.clearTimeout(timer)
        reject(new Error('unsupported video'))
      }
    })

    const duration = Number.isFinite(video.duration) ? video.duration : 0
    await new Promise<void>((resolve) => {
      const done = () => resolve()
      video.onseeked = done
      try {
        video.currentTime = Math.min(0.24, Math.max(0.02, duration / 8))
      } catch {
        done()
      }
      window.setTimeout(done, 1600)
    })

    const width = video.videoWidth || 720
    const height = video.videoHeight || 720
    const max = MEDIA_LIMITS.posterMaxEdge
    const scale = Math.min(1, max / Math.max(width, height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(width * scale))
    canvas.height = Math.max(1, Math.round(height * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas unavailable')
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

    return {
      poster: canvas.toDataURL('image/jpeg', MEDIA_LIMITS.posterQuality),
      durationSec: Math.round(duration * 10) / 10,
    }
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Resolve an uploaded clip id (or a static demo url) into a playable src. */
export function useClipURL(videoId?: string, video?: string): string {
  const [url, setUrl] = useState(video ?? '')

  useEffect(() => {
    let alive = true
    if (video) {
      setUrl(video)
      return
    }
    if (!videoId) {
      setUrl('')
      return
    }
    clipURL(videoId)
      .then((next) => {
        if (alive) setUrl(next)
      })
      .catch(() => {
        if (alive) setUrl('')
      })
    return () => {
      alive = false
    }
  }, [videoId, video])

  return url
}

export function formatClipLength(sec?: number): string {
  if (!sec || !Number.isFinite(sec)) return ''
  const total = Math.round(sec)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}
