import { useEffect, useState } from 'react'
import { MEDIA_LIMITS, STORAGE_KEYS } from '../data/config'
import type { MediaKind, MediaPresignInput } from '../data/api'
import { ApiError, api, mediaApi } from '../data/api'

type Encoded = { blob: Blob; width: number; height: number }

async function loadImage(file: File): Promise<{ img: HTMLImageElement; release: () => void }> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('image decode failed'))
      el.src = url
    })
    return { img, release: () => URL.revokeObjectURL(url) }
  } catch (error) {
    URL.revokeObjectURL(url)
    throw error
  }
}

/** Downscale and re-encode a picked photo into a JPEG blob. */
export async function compressToBlob(
  file: File,
  maxEdge: number = MEDIA_LIMITS.photoMaxEdge,
  quality: number = MEDIA_LIMITS.photoQuality,
): Promise<Encoded> {
  const { img, release } = await loadImage(file)
  try {
    const scale = Math.min(1, maxEdge / Math.max(img.width, img.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(img.width * scale))
    canvas.height = Math.max(1, Math.round(img.height * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D context is unavailable')
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (next) => (next ? resolve(next) : reject(new Error('JPEG encode failed'))),
        'image/jpeg',
        quality,
      )
    })
    return { blob, width: canvas.width, height: canvas.height }
  } finally {
    release()
  }
}

/** Downscale and re-encode a picked photo so it fits comfortably in localStorage. */
export async function compressImage(file: File): Promise<string> {
  const { blob } = await compressToBlob(file)
  return dataURL(blob)
}

/** 给视觉模型用的小图：768px JPEG，避免把原图和大图传上云。 */
export async function shrinkToDataURL(src: string, maxEdge = 768): Promise<string> {
  const response = await fetch(src)
  if (!response.ok) throw new Error('读取照片失败')
  const blob = await response.blob()
  const file = new File([blob], 'vision.jpg', { type: blob.type || 'image/jpeg' })
  const { blob: small } = await compressToBlob(file, maxEdge, 0.82)
  return dataURL(small)
}

function dataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('read failed'))
    reader.readAsDataURL(blob)
  })
}

async function blobFromDataURL(url: string): Promise<Blob> {
  const response = await fetch(url)
  return response.blob()
}

export type UploadedMedia = { id: string; url: string }

/**
 * 上传一个文件到媒体存储：先向后端要预签名地址，再直传对象存储；
 * 没配对象存储时后端会回 mode=proxy，改由应用服务器中转。
 */
export async function uploadMedia(
  blob: Blob,
  kind: MediaKind,
  extra: Partial<Omit<MediaPresignInput, 'kind' | 'bytes' | 'mime'>> = {},
): Promise<UploadedMedia> {
  const presign = await mediaApi.presign({
    kind,
    mime: blob.type || (kind === 'photo' ? 'image/jpeg' : 'video/mp4'),
    bytes: blob.size,
    ...extra,
  })

  let response: Response
  try {
    response = await fetch(presign.uploadUrl, {
      method: presign.method || 'PUT',
      headers: presign.headers,
      body: blob,
      credentials: 'same-origin',
    })
  } catch {
    throw new ApiError(0, 'upload_network', '上传中断，检查网络后再试一次')
  }
  if (!response.ok) {
    throw new ApiError(response.status, 'upload_failed', `上传失败（HTTP ${response.status}）`)
  }
  if (presign.mode === 's3') {
    await mediaApi.confirm(presign.id)
  }
  return { id: presign.id, url: presign.url }
}

/** 账号头像：512px 方图，上传后把 media id 设为当前账号头像。 */
export async function uploadAvatar(file: File): Promise<string> {
  const { blob, width, height } = await compressToBlob(file, 512, 0.86)
  const uploaded = await uploadMedia(blob, 'photo', { width, height })
  const { avatarUrl } = await api.setAvatar(uploaded.id)
  return avatarUrl
}

/** 照片：原图（长边 1200）+ 缩略图（长边 480），两张分别上传。 */
export async function uploadPhoto(file: File): Promise<{ url: string; thumb: string }> {
  const full = await compressToBlob(file, MEDIA_LIMITS.photoMaxEdge, MEDIA_LIMITS.photoQuality)
  const small = await compressToBlob(file, MEDIA_LIMITS.thumbMaxEdge, MEDIA_LIMITS.thumbQuality)
  const [main, thumb] = await Promise.all([
    uploadMedia(full.blob, 'photo', { width: full.width, height: full.height }),
    uploadMedia(small.blob, 'photo', { width: small.width, height: small.height }),
  ])
  return { url: main.url, thumb: thumb.url }
}

/** 视频：上传片子本身，海报帧当作一张照片上传。 */
export async function uploadClip(
  file: File,
  info: VideoInfo,
  kind: 'video' | 'live',
): Promise<{ url: string; poster: string }> {
  const posterBlob = await blobFromDataURL(info.poster)
  const [clip, poster] = await Promise.all([
    uploadMedia(file, kind, { durationSec: info.durationSec }),
    uploadMedia(posterBlob, 'photo'),
  ])
  return { url: clip.url, poster: poster.url }
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
