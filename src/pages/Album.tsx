import { useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { Icon } from '../brand/icons'
import { TabHead, SectionHead } from '../components/Common'
import { AlbumAiCard } from '../components/AiPanels'
import { Sheet } from '../components/Sheet'
import { useStore, uid } from '../data/store'
import { usePhotoInk, usePhotoInkMap } from '../lib/photoTone'
import { ageBetween, fromISODate, longDate, monthDay, monthLabel, timeHM, toISODate } from '../lib/date'
import { formatClipLength, inspectVideo, shrinkToDataURL, uploadClip, uploadPhoto, useClipURL } from '../lib/media'
import { viewerName } from '../lib/viewer'
import type { Photo, PhotoMotion } from '../data/types'
import { hasMotion, isVideoPhoto, motionOf } from '../lib/photo'
import { isBeforeBirth } from '../lib/birth'
import { MEDIA_GROUPS, MEDIA_LIMITS } from '../data/config'
import { ApiError, mediaApi } from '../data/api'
import { navigate } from '../lib/route'

/** Badge for a motion clip: LIVE for live photos, length for videos. */
async function requestCaptionTitles(src: string, hint: string): Promise<string[]> {
  const image = await shrinkToDataURL(src, 768)
  const res = await fetch('/api/ai/caption', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image, hint }),
  })
  const body = (await res.json().catch(() => ({}))) as { titles?: unknown; message?: string }
  if (!res.ok) {
    throw new Error(res.status >= 500 ? 'AI 暂时不可用，请稍后再试' : body.message || '这次没想出合适的标题')
  }
  const titles = Array.isArray(body.titles) ? body.titles.filter((t): t is string => typeof t === 'string') : []
  if (!titles.length) throw new Error('这次没想出合适的标题')
  return titles.slice(0, 3)
}

function KindBadge({ photo, variant }: { photo: Photo; variant?: 'cover' }) {  if (hasMotion(photo)) {
    return (
      <span className={`album-badge album-badge--live${variant === 'cover' ? ' album-badge--cover' : ''}`}>
        <span className="album-badge__dot" />
        live
      </span>
    )
  }
  if (isVideoPhoto(photo)) {
    return (
      <span className={`album-badge${variant === 'cover' ? ' album-badge--cover' : ''}`}>
        <Icon name="play" size={9} />
        {formatClipLength(photo.durationSec) || '视频'}
      </span>
    )
  }
  return null
}

function AlbumPhotoCard({
  photo,
  onOpen,
  selectable,
  selected,
}: {
  photo: Photo
  onOpen: (photo: Photo) => void
  selectable?: boolean
  selected?: boolean
}) {
  const imgRef = useRef<HTMLImageElement>(null)
  const ink = usePhotoInk(imgRef)

  return (
    <button
      className={`album-card${selectable ? ' album-card--selectable' : ''}${selected ? ' is-selected' : ''}`}
      data-kind={photo.kind ?? 'photo'}
      data-motion={hasMotion(photo) ? 'true' : 'false'}
      data-photo-ink={ink ?? undefined}
      aria-pressed={selectable ? !!selected : undefined}
      aria-label={selectable ? `${selected ? '取消选择' : '选择'}「${photo.caption}」` : undefined}
      onClick={() => onOpen(photo)}
    >
      <img ref={imgRef} src={photo.thumb} alt={photo.caption} loading="lazy" />
      <span className="album-card__veil" />
      <KindBadge photo={photo} />
      {selectable ? (
        <span className={`album-card__check${selected ? ' is-on' : ''}`} aria-hidden="true">
          {selected ? <Icon name="check" size={13} /> : null}
        </span>
      ) : null}
      <span className="album-card__cap">
        <b>{photo.caption}</b>
        <span>{monthDay(photo.at)}</span>
      </span>
    </button>
  )
}

function AlbumMoreCard({
  photo,
  count,
  onOpen,
}: {
  photo: Photo
  count: number
  onOpen: () => void
}) {
  const imgRef = useRef<HTMLImageElement>(null)
  const ink = usePhotoInk(imgRef)

  return (
    <button
      type="button"
      className="album-card album-card--more"
      data-photo-ink={ink ?? undefined}
      aria-label={`查看全部照片，还有 ${count} 张`}
      onClick={onOpen}
    >
      <img ref={imgRef} src={photo.thumb} alt="" aria-hidden="true" loading="lazy" />
      <span className="album-more__veil" />
      <span className="album-more__label">
        <b>more</b>
        <span>+{count} 张</span>
      </span>
    </button>
  )
}

function LightboxMedia({ photo }: { photo: Photo }) {
  const motion = motionOf(photo)
  const url = useClipURL(motion?.videoId ?? photo.videoId, motion?.video ?? photo.video)

  if (isVideoPhoto(photo)) {
    return (
      <video
        className="lightbox__clip"
        src={url}
        poster={photo.src}
        controls
        autoPlay
        playsInline
      />
    )
  }
  if (motion) {
    return (
      <div className="lightbox__live">
        <video
          className="lightbox__clip"
          src={url}
          poster={photo.src}
          autoPlay
          muted
          loop
          playsInline
        />
        <span className="lightbox__live-tag">live</span>
      </div>
    )
  }
  return <img src={photo.src} alt={photo.caption} />
}

type PickMode = 'photo' | 'live' | 'video'

type AlbumDraft = {
  src: string
  thumb: string
  kind: 'photo' | 'video'
  motion?: PhotoMotion
  video?: string
  durationSec?: number
  atDate: string
  atTime: string
  caption: string
}

export default function AlbumPage() {
  const { state, dispatch, toast } = useStore()
  const viewer = viewerName(state)
  const [filter, setFilter] = useState<'all' | string>('all')
  const [lightboxList, setLightboxList] = useState<Photo[]>([])
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [allOpen, setAllOpen] = useState(false)
  const [draft, setDraft] = useState<AlbumDraft | null>(null)
  const [captionEdit, setCaptionEdit] = useState<{ id: string; value: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [pendingDelete, setPendingDelete] = useState<string[] | null>(null)
  const [deleting, setDeleting] = useState(false)
  const canDelete = state.family.some((m) => m.id === state.viewerId && m.permission === 'admin')
  const [aiBusy, setAiBusy] = useState(false)
  const [aiTitles, setAiTitles] = useState<string[]>([])
  const aiSeq = useRef(0)
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [ratio, setRatio] = useState(1)
  const [bare, setBare] = useState(false)
  const [slideDir, setSlideDir] = useState<'next' | 'prev'>('next')
  const [gesturing, setGesturing] = useState(false)
  const stageRef = useRef<HTMLDivElement>(null)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const gesture = useRef<{
    x: number
    y: number
    at: number
    moved: boolean
    offsetX: number
    offsetY: number
    scale: number
    onVideo: boolean
    captured: boolean
  } | null>(null)
  const pinch = useRef<{
    dist: number
    midX: number
    midY: number
    scale: number
    offsetX: number
    offsetY: number
  } | null>(null)
  const tapTimer = useRef<number | null>(null)
  const lastTap = useRef(0)

  const photoRef = useRef<HTMLInputElement>(null)
  const photoCamRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<HTMLInputElement>(null)
  const videoCamRef = useRef<HTMLInputElement>(null)

  const mediaRefs = {
    photoLibrary: photoRef,
    photoCamera: photoCamRef,
    videoLibrary: videoRef,
    videoCamera: videoCamRef,
  }

  const photos = [...state.photos].sort((a, b) => b.at - a.at)
  const months = useMemo(() => {
    const keys: { key: string; label: string }[] = []
    for (const p of photos) {
      const d = new Date(p.at)
      const key = `${d.getFullYear()}-${d.getMonth() + 1}`
      if (!keys.some((k) => k.key === key)) {
        keys.push({ key, label: `${d.getMonth() + 1} 月` })
      }
    }
    return keys
  }, [photos])

  const visible = filter === 'all' ? photos : photos.filter((p) => {
    const d = new Date(p.at)
    return `${d.getFullYear()}-${d.getMonth() + 1}` === filter
  })

  const lightbox = lightboxIndex === null ? null : lightboxList[lightboxIndex] ?? null
  const lightboxStill = lightbox ? !isVideoPhoto(lightbox) && !hasMotion(lightbox) : false
  const lightboxToneOK = lightbox ? !isVideoPhoto(lightbox) : false
  const coverImgRef = useRef<HTMLImageElement>(null)
  const coverInk = usePhotoInk(coverImgRef, photos[0]?.id)
  const lightboxImgRef = useRef<HTMLImageElement>(null)
  const lightboxInk = usePhotoInk(lightboxImgRef, lightbox?.id)
  const lightboxTones = usePhotoInkMap(
    photos.map((photo) => ({ id: photo.id, src: photo.src })),
    lightboxIndex !== null,
  )
  const lightboxTone =
    lightboxInk ??
    (lightbox ? lightboxTones[lightbox.id] : null) ??
    (photos[0]?.id === lightbox?.id ? coverInk : null)

  const clampOffset = (x: number, y: number, nextScale: number) => {
    const stage = stageRef.current
    if (!stage) return { x, y }
    const W = stage.clientWidth
    const H = stage.clientHeight
    let baseW = W
    let baseH = W / ratio
    if (baseH > H) {
      baseH = H
      baseW = H * ratio
    }
    const maxX = Math.max(0, (baseW * nextScale - W) / 2)
    const maxY = Math.max(0, (baseH * nextScale - H) / 2)
    return {
      x: Math.min(maxX, Math.max(-maxX, x)),
      y: Math.min(maxY, Math.max(-maxY, y)),
    }
  }

  const toggleZoom = () => {
    if (scale > 1) {
      setScale(1)
      setOffset({ x: 0, y: 0 })
      return
    }
    setScale(2)
    setOffset(clampOffset(0, 0, 2))
  }

  const onStagePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return

    const onVideo = !!(event.target as HTMLElement).closest('video')
    const captured = !onVideo
    if (captured) event.currentTarget.setPointerCapture(event.pointerId)
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })

    if (pointers.current.size === 1) {
      gesture.current = {
        x: event.clientX,
        y: event.clientY,
        at: Date.now(),
        moved: false,
        offsetX: offset.x,
        offsetY: offset.y,
        scale,
        onVideo,
        captured,
      }
      setGesturing(true)
      return
    }

    if (pointers.current.size === 2) {
      if (!lightboxStill) {
        gesture.current = null
        pinch.current = null
        return
      }
      const [a, b] = [...pointers.current.values()]
      pinch.current = {
        dist: Math.hypot(b.x - a.x, b.y - a.y),
        midX: (a.x + b.x) / 2,
        midY: (a.y + b.y) / 2,
        scale,
        offsetX: offset.x,
        offsetY: offset.y,
      }
      gesture.current = null
      if (tapTimer.current !== null) {
        window.clearTimeout(tapTimer.current)
        tapTimer.current = null
      }
    }
  }

  const onStagePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId)) return
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })

    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()]
      const dist = Math.hypot(b.x - a.x, b.y - a.y)
      const midX = (a.x + b.x) / 2
      const midY = (a.y + b.y) / 2
      const nextScale = Math.min(4, Math.max(1, (pinch.current.scale * dist) / Math.max(1, pinch.current.dist)))
      setScale(nextScale)
      setOffset(
        clampOffset(
          pinch.current.offsetX + (midX - pinch.current.midX),
          pinch.current.offsetY + (midY - pinch.current.midY),
          nextScale,
        ),
      )
      return
    }

    const start = gesture.current
    if (!start || pointers.current.size !== 1) return
    const dx = event.clientX - start.x
    const dy = event.clientY - start.y
    if (Math.abs(dx) + Math.abs(dy) > 6) start.moved = true
    if (start.scale > 1) {
      setOffset(clampOffset(start.offsetX + dx, start.offsetY + dy, start.scale))
    }
  }

  const onStagePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId)) return
    pointers.current.delete(event.pointerId)
    const start = gesture.current
    if (start?.captured) {
      try {
        event.currentTarget.releasePointerCapture(event.pointerId)
      } catch {
        /* pointer already released */
      }
    }
    if (pointers.current.size > 0) return

    setGesturing(false)

    if (pinch.current) {
      pinch.current = null
      if (scale < 1.03) {
        setScale(1)
        setOffset({ x: 0, y: 0 })
      }
      return
    }

    if (!start) return
    gesture.current = null
    const dx = event.clientX - start.x
    const dy = event.clientY - start.y
    if (Math.abs(dx) > 44 && Math.abs(dx) > Math.abs(dy) * 1.2 && scale <= 1.01) {
      stepLightbox(dx < 0 ? 1 : -1)
      return
    }

    if (start.onVideo) return

    if (start.moved || Date.now() - start.at > 320) return

    const now = Date.now()
    if (now - lastTap.current < 350) {
      lastTap.current = 0
      if (tapTimer.current !== null) {
        window.clearTimeout(tapTimer.current)
        tapTimer.current = null
      }
      toggleZoom()
      return
    }

    lastTap.current = now
    tapTimer.current = window.setTimeout(() => {
      setBare((current) => !current)
      lastTap.current = 0
      tapTimer.current = null
    }, 300)
  }

  const onStagePointerCancel = (event: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId)
    if (pointers.current.size === 0) {
      gesture.current = null
      pinch.current = null
      setGesturing(false)
    }
  }

  useEffect(() => {
    setScale(1)
    setOffset({ x: 0, y: 0 })
    setRatio(1)
  }, [lightbox?.id])

  const stepLightbox = (delta: number) => {
    if (lightboxList.length < 2) return
    setSlideDir(delta > 0 ? 'next' : 'prev')
    setLightboxIndex((current) => {
      if (current === null) return current
      return Math.max(0, Math.min(lightboxList.length - 1, current + delta))
    })
  }

  const openLightbox = (photo: Photo) => {
    const index = visible.findIndex((p) => p.id === photo.id)
    setLightboxList(visible)
    setLightboxIndex(index >= 0 ? index : 0)
  }

  const openCover = (photo: Photo) => {
    setLightboxList([photo])
    setLightboxIndex(0)
  }

  useEffect(() => {
    if (lightboxIndex === null) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setLightboxIndex(null)
      if (scale > 1) return
      if (event.key === 'ArrowLeft') stepLightbox(-1)
      if (event.key === 'ArrowRight') stepLightbox(1)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [lightboxIndex, lightboxList.length, scale])

  useEffect(() => {
    if (!allOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onPop = () => {
      setLightboxIndex(null)
      setAllOpen(false)
    }
    window.addEventListener('popstate', onPop)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('popstate', onPop)
    }
  }, [allOpen])

  const openFullGallery = () => {
    setAllOpen(true)
    const nextState = { ...((history.state ?? {}) as Record<string, unknown>) }
    history.pushState({ ...nextState, nestoryAlbumAll: true }, '', window.location.hash)
  }

  const closeFullGallery = () => {
    if ((history.state as Record<string, unknown> | null)?.nestoryAlbumAll) history.back()
    else setAllOpen(false)
  }

  const photoCard = (p: Photo) => (
    <AlbumPhotoCard
      key={p.id}
      photo={p}
      onOpen={selectMode ? (photo) => toggleSelect(photo.id) : openLightbox}
      selectable={selectMode}
      selected={selected.includes(p.id)}
    />
  )

  const previewGrid = (items: Photo[]) => {
    const shown = selectMode ? items : items.length > 4 ? items.slice(0, 3) : items
    return (
      <div className="album-grid album-grid--rest album-grid--preview">
        {shown.map(photoCard)}
        {!selectMode && items.length > 4 ? (
          <AlbumMoreCard
            photo={items[3]}
            count={items.length - 3}
            onOpen={openFullGallery}
          />
        ) : null}
      </div>
    )
  }

  const toggleSelect = (id: string) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const exitSelect = () => {
    setSelectMode(false)
    setSelected([])
  }

  const trashedIds = (photos: Photo[]) => {
    const ids: string[] = []
    for (const photo of photos) {
      const match = /\/api\/media\/blob\/([A-Za-z0-9_-]+)/.exec(photo.src)
      if (match) ids.push(match[1])
    }
    return ids
  }

  const deleteSelected = async () => {
    if (!pendingDelete?.length || deleting) return
    const chosen = pendingDelete
    const byId = new Map(state.photos.map((p) => [p.id, p]))
    const items = chosen.map((id) => byId.get(id)).filter((p): p is Photo => !!p)
    setDeleting(true)
    const removed: Photo[] = []
    let avatarBlocked = false
    let failed = false
    for (const photo of items) {
      const mediaId = trashedIds([photo])[0]
      if (mediaId) {
        try {
          await mediaApi.remove(mediaId)
        } catch (err) {
          if (err instanceof ApiError && err.code === 'avatar_in_use') {
            avatarBlocked = true
            continue
          }
          if (!(err instanceof ApiError && err.status === 404)) {
            failed = true
            continue
          }
        }
      }
      removed.push(photo)
    }
    if (removed.length) {
      dispatch({ type: 'trashPhotos', photos: removed, deletedAt: Date.now() })
    }
    setDeleting(false)
    setPendingDelete(null)
    exitSelect()
    if (avatarBlocked) toast('有照片正在作为头像，先换掉头像再删')
    else if (failed) toast('有照片没能删掉，稍后再试')
    else if (removed.length) toast(`已移入最近删除 · ${removed.length} 项，7 天内可恢复`)
  }

  const groups = useMemo(() => {
    const out: { key: string; label: string; monthIndex: number; items: Photo[] }[] = []
    for (const p of visible) {
      const d = new Date(p.at)
      const key = `${d.getFullYear()}-${d.getMonth() + 1}`
      const existing = out.find((g) => g.key === key)
      if (existing) existing.items.push(p)
      else
        out.push({
          key,
          label: monthLabel(p.at),
          monthIndex: Math.max(1, ageBetween(new Date(fromISODate(state.baby.birthday)), d).months + 1),
          items: [p],
        })
    }
    return out
  }, [visible, state.baby.birthday])

  const onPick = async (file: File | undefined, picked: PickMode, input: HTMLInputElement) => {
    if (!file || busy) return
    const isClip = file.type.startsWith('video/') || /\.(mov|mp4|m4v)$/i.test(file.name)
    const mode: PickMode = picked === 'photo' && isClip ? 'live' : picked
    setBusy(true)
    try {
      const now = Date.now()
      resetAi()
      if (mode === 'photo') {
        const { url, thumb } = await uploadPhoto(file)
        setDraft({
          src: url,
          thumb,
          kind: 'photo',
          atDate: toISODate(now),
          atTime: timeHM(now),
          caption: '',
        })
      } else {
        if (file.size > MEDIA_LIMITS.videoMaxMB * 1024 * 1024) {
          toast(`这段视频超过 ${MEDIA_LIMITS.videoMaxMB} MB，换一段短一些的`)
          return
        }
        const info = await inspectVideo(file)
        const { url, poster } = await uploadClip(file, info, mode)
        setDraft({
          src: poster,
          thumb: poster,
          kind: mode === 'live' ? 'photo' : 'video',
          motion: mode === 'live' ? { video: url, durationSec: info.durationSec } : undefined,
          video: mode === 'live' ? undefined : url,
          durationSec: mode === 'live' ? undefined : info.durationSec,
          atDate: toISODate(now),
          atTime: timeHM(now),
          caption: '',
        })
      }
      setAddOpen(false)
    } catch (error) {
      toast(error instanceof ApiError ? error.message : '这个文件暂时无法读取')
    } finally {
      setBusy(false)
      input.value = ''
    }
  }

  const saveDraft = () => {
    if (!draft) return
    if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.atDate) || !/^\d{2}:\d{2}$/.test(draft.atTime)) {
      toast('请选择有效的日期和时间')
      return
    }
    const [hh, mm] = draft.atTime.split(':').map(Number)
    if (!Number.isInteger(hh) || !Number.isInteger(mm) || hh > 23 || mm > 59) {
      toast('请选择有效的时间')
      return
    }
    const at = fromISODate(draft.atDate, hh, mm)
    if (!Number.isFinite(at)) {
      toast('请选择有效的时间')
      return
    }
    if (at > Date.now() + 60_000) {
      toast('时间不能晚于现在')
      return
    }
    if (isBeforeBirth(at, state.baby)) {
      toast('照片不能早于宝宝的生日')
      return
    }
    const fallback = monthDay(at)
    const caption = draft.caption.trim() || fallback
    dispatch({
      type: 'addPhoto',
      photo: {
        id: uid('ph'),
        src: draft.src,
        thumb: draft.thumb,
        at,
        caption,
        author: viewer,
        kind: draft.kind,
        motion: draft.motion,
        video: draft.video,
        durationSec: draft.durationSec,
      },
    })
    setDraft(null)
    resetAi()
    setFilter('all')
    toast(draft.kind === 'video' ? '视频已加入相册' : draft.motion ? '会动的照片已加入相册' : '照片已加入相册')
  }

  const askAi = async (src: string, hint: string) => {
    const seq = ++aiSeq.current
    setAiBusy(true)
    setAiTitles([])
    try {
      const titles = await requestCaptionTitles(src, hint)
      if (seq === aiSeq.current) setAiTitles(titles)
    } catch (err) {
      if (seq === aiSeq.current) {
        const message = err instanceof Error ? err.message : '这次没想出合适的标题'
        toast(message.includes('fetch') ? 'AI 暂时连不上，先手动写一句吧' : message)
      }
    } finally {
      if (seq === aiSeq.current) setAiBusy(false)
    }
  }

  const resetAi = () => {
    aiSeq.current += 1
    setAiBusy(false)
    setAiTitles([])
  }

  const saveCaption = () => {
    if (!captionEdit) return
    const photo = state.photos.find((p) => p.id === captionEdit.id)
    if (!photo) return
    const caption = captionEdit.value.trim() || monthDay(photo.at)
    dispatch({ type: 'updatePhoto', id: photo.id, patch: { caption } })
    setCaptionEdit(null)
    resetAi()
    toast('标题已更新')
  }

  const milestones = [...state.milestones].sort((a, b) => b.at - a.at)
  const cover = photos[0] ?? null
  const scope = months.find((m) => m.key === filter)?.label

  return (
    <div className="page">
      <TabHead
        en="FAMILY ALBUM"
        title="成长相册"
        meta={
          filter === 'all'
            ? `${photos.length} 个瞬间 · ${months.length} 个月`
            : `${visible.length} 个瞬间 · ${scope ?? ''}`
        }
        right={
          <>
            {canDelete && photos.length ? (
              <button
                type="button"
                className="album-select-toggle"
                onClick={() => (selectMode ? exitSelect() : setSelectMode(true))}
              >
                {selectMode ? '完成' : '选择'}
              </button>
            ) : null}
            <button className="icon-btn" aria-label="添加到相册" onClick={() => setAddOpen(true)}>
              <Icon name="plus" size={19} />
            </button>
          </>
        }
      />

      <div className="page__body">
        {cover ? (
          <button
            className="album-cover"
            data-kind={cover.kind ?? 'photo'}
            data-motion={hasMotion(cover) ? 'true' : 'false'}
            data-photo-ink={coverInk ?? undefined}
            onClick={() => openCover(cover)}
          >
            <img ref={coverImgRef} src={cover.src} alt={cover.caption} />
            <span className="album-cover__veil" />
            <span className="album-cover__tag">最近的一张</span>
            <KindBadge photo={cover} variant="cover" />
            <span className="album-cover__cap">
              <b>{cover.caption}</b>
              <span>
                {longDate(cover.at)} · {cover.author} {isVideoPhoto(cover) ? '录制' : '拍摄'}
                {hasMotion(cover) ? ' · live' : ''}
              </span>
            </span>
          </button>
        ) : null}

        <AlbumAiCard />

        <div className="chip-row" style={{ marginTop: 16 }}>
          <button className={`chip${filter === 'all' ? ' chip--on' : ''}`} onClick={() => setFilter('all')}>
            全部 · {photos.length}
          </button>
          {months.map((m) => (
            <button
              key={m.key}
              className={`chip${filter === m.key ? ' chip--on' : ''}`}
              onClick={() => setFilter(m.key)}
            >
              {m.label}
            </button>
          ))}
        </div>

        {groups.length === 0 ? (
          <div className="empty" style={{ paddingTop: 60 }}>
            这里会慢慢装满成长的样子。
            <br />
            点击右上角，放入第一张照片或视频。
          </div>
        ) : filter === 'all' ? (
          previewGrid(visible)
        ) : (
          groups.map((g) => (
            <section key={g.key}>
              <div className="months">
                <span className="months__title">{g.label}</span>
                <span className="months__sub">
                  第 {g.monthIndex} 个月 · {g.items.length} 张
                </span>
              </div>
              {previewGrid(g.items)}
            </section>
          ))
        )}

        <section style={{ marginTop: 34 }}>
          <SectionHead title="成长时间轴" en="Milestones" />
          <div className="story">
            {milestones.map((m) => (
              <div key={m.id} className="story__item">
                <span className="story__dot" />
                <span className="story__text">
                  {m.title}
                  {m.note ? (
                    <span style={{ display: 'block', fontSize: 'calc(10.5px * var(--type-scale, 1))', color: 'var(--ink-3)', marginTop: 2 }}>{m.note}</span>
                  ) : null}
                </span>
                <span className="story__date">{longDate(m.at)}</span>
              </div>
            ))}
          </div>
        </section>

        <p className="about-note">
          照片与成长数据仅家庭成员可见，默认不公开。
          <br />
          Nestory 珍藏每一个普通的日子。
        </p>

        {canDelete ? (
          <button type="button" className="album-trash-link" onClick={() => navigate('trash', 'album')}>
            <Icon name="trash" size={14} />
            最近删除
          </button>
        ) : null}
      </div>

      {selectMode ? (
        <div className="album-select-bar">
          <button type="button" className="album-select-bar__cancel" onClick={exitSelect}>
            取消
          </button>
          <span className="album-select-bar__count">
            {selected.length ? `已选 ${selected.length} 项` : '选择要删除的照片'}
          </span>
          <button
            type="button"
            className="album-select-bar__delete"
            disabled={!selected.length}
            onClick={() => setPendingDelete(selected)}
          >
            <Icon name="trash" size={15} />
            移入回收站
          </button>
        </div>
      ) : null}

      <Sheet
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="添加到相册"
        desc="照片留在这里，视频单独存放。"
        footer={
          <p className="media-note">
            Live / 会动的照片会作为一张照片保存，查看时循环播放。
          </p>
        }
      >
        <div className="media-add">
          {MEDIA_GROUPS.map((group) => (
            <div className="media-add__group" key={group.key}>
              <span className="media-add__label">{group.label}</span>
              {group.options.map((option) => (
                <button
                  key={option.key}
                  className="media-opt"
                  disabled={busy}
                  onClick={() => mediaRefs[option.trigger].current?.click()}
                >
                  <span
                    className={`media-opt__icon${option.tone === 'live' ? ' media-opt__icon--live' : ''}`}
                  >
                    <Icon name={option.icon} size={19} />
                  </span>
                  <span className="media-opt__text">
                    <b>{option.title}</b>
                    <small>
                      {option.desc}
                      {option.limit ? ` · 最长 ${MEDIA_LIMITS[option.limit]} MB` : ''}
                    </small>
                  </span>
                  <Icon name="chevronRight" size={16} />
                </button>
              ))}
            </div>
          ))}
        </div>
      </Sheet>

      <Sheet
        open={!!draft}
        onClose={() => {
          setDraft(null)
          resetAi()
        }}
        title="这一刻"
        desc="给这一刻写一句话；不写就用日期当标题。"
        footer={
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              className="btn btn--quiet"
              style={{ flex: 1 }}
              onClick={() => {
                setDraft(null)
                resetAi()
              }}
            >
              取消
            </button>
            <button className="btn btn--primary" style={{ flex: 2 }} onClick={saveDraft}>
              保存到相册
            </button>
          </div>
        }
      >
        {draft ? (
          <div className="album-draft">
            <div className="album-draft__media">
              <img src={draft.src} alt="" />
              {draft.kind === 'video' ? (
                <span className="album-badge album-badge--cover">
                  <Icon name="play" size={9} />
                  {formatClipLength(draft.durationSec) || '视频'}
                </span>
              ) : draft.motion ? (
                <span className="album-badge album-badge--live album-badge--cover">
                  <span className="album-badge__dot" />
                  live
                </span>
              ) : null}
            </div>
            <div className="field">
              <div className="album-ai__head">
                <span className="field__label">标题 · 选填</span>
                <button
                  type="button"
                  className="album-ai__ask"
                  disabled={aiBusy}
                  onClick={() => askAi(draft.src, `拍摄于 ${draft.atDate}`)}
                >
                  {aiBusy ? '正在想…' : '✦ 帮我想一句'}
                </button>
              </div>
              <input
                className="input"
                value={draft.caption}
                maxLength={24}
                placeholder="例如：睡着时的小呼吸"
                onChange={(e) => setDraft({ ...draft, caption: e.target.value })}
              />
              {aiTitles.length ? (
                <div className="album-ai__chips">
                  {aiTitles.map((title) => (
                    <button
                      key={title}
                      type="button"
                      className="album-ai__chip"
                      onClick={() => {
                        setDraft({ ...draft, caption: title })
                        setAiTitles([])
                      }}
                    >
                      {title}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="field-row">
              <label className="field">
                <span className="field__label">日期</span>
                <input
                  className="input"
                  type="date"
                  value={draft.atDate}
                  max={toISODate(Date.now())}
                  min={state.baby.birthday || undefined}
                  onChange={(e) => setDraft({ ...draft, atDate: e.target.value })}
                />
              </label>
              <label className="field">
                <span className="field__label">时间</span>
                <input
                  className="input"
                  type="time"
                  value={draft.atTime}
                  onChange={(e) => setDraft({ ...draft, atTime: e.target.value })}
                />
              </label>
            </div>
            <p className="media-note">标题之后也可以随时修改。</p>
          </div>
        ) : null}
      </Sheet>

      <Sheet
        open={!!captionEdit}
        onClose={() => {
          setCaptionEdit(null)
          resetAi()
        }}
        title="修改标题"
        footer={
          <button className="btn btn--primary btn--full" onClick={saveCaption}>
            保存标题
          </button>
        }
      >
        {captionEdit ? (
          <div className="field">
            <div className="album-ai__head">
              <span className="field__label">给这一刻写一句话</span>
              <button
                type="button"
                className="album-ai__ask"
                disabled={aiBusy}
                onClick={() => {
                  const photo = state.photos.find((p) => p.id === captionEdit.id)
                  if (photo) askAi(photo.src, `拍摄于 ${monthDay(photo.at)}`)
                }}
              >
                {aiBusy ? '正在想…' : '✦ 帮我想一句'}
              </button>
            </div>
            <input
              className="input"
              value={captionEdit.value}
              maxLength={24}
              placeholder="留空会用日期当标题"
              onChange={(e) => setCaptionEdit({ ...captionEdit, value: e.target.value })}
            />
            <span className="field__hint">留空时，标题会变成拍摄日期。</span>
            {aiTitles.length ? (
              <div className="album-ai__chips">
                {aiTitles.map((title) => (
                  <button
                    key={title}
                    type="button"
                    className="album-ai__chip"
                    onClick={() => {
                      setCaptionEdit({ ...captionEdit, value: title })
                      setAiTitles([])
                    }}
                  >
                    {title}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </Sheet>

      <Sheet
        open={!!pendingDelete}
        onClose={() => {
          if (!deleting) setPendingDelete(null)
        }}
        title="移入最近删除？"
        desc="照片会保留 7 天，期间家人看不到，但你可以从「最近删除」恢复。7 天后自动彻底删除，无法找回。"
        footer={
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              className="btn btn--quiet"
              style={{ flex: 1 }}
              disabled={deleting}
              onClick={() => setPendingDelete(null)}
            >
              再想想
            </button>
            <button
              className="btn btn--primary"
              style={{ flex: 2 }}
              disabled={deleting}
              onClick={deleteSelected}
            >
              {deleting ? '正在移入…' : `移入回收站${pendingDelete?.length ? ` · ${pendingDelete.length} 项` : ''}`}
            </button>
          </div>
        }
      >
        <p className="album-trash-note">
          {pendingDelete?.length
            ? `将移入最近删除：${pendingDelete
                .map((id) => state.photos.find((p) => p.id === id)?.caption ?? '')
                .filter(Boolean)
                .slice(0, 3)
                .join('、')}${pendingDelete.length > 3 ? ' 等' : ''}`
            : ''}
        </p>
      </Sheet>

      <input
        ref={photoRef}
        type="file"
        accept="image/*,video/*,.mov"
        aria-label="从相册选择照片或视频"
        className="sr-only"
        onChange={(e) => onPick(e.target.files?.[0], 'photo', e.target)}
      />
      <input
        ref={photoCamRef}
        type="file"
        accept="image/*"
        capture="environment"
        aria-label="拍照"
        className="sr-only"
        onChange={(e) => onPick(e.target.files?.[0], 'photo', e.target)}
      />
      <input
        ref={videoRef}
        type="file"
        accept="video/*"
        aria-label="从相册选择视频"
        className="sr-only"
        onChange={(e) => onPick(e.target.files?.[0], 'video', e.target)}
      />
      <input
        ref={videoCamRef}
        type="file"
        accept="video/*"
        capture="environment"
        aria-label="拍视频"
        className="sr-only"
        onChange={(e) => onPick(e.target.files?.[0], 'video', e.target)}
      />

      {allOpen ? (
        <div className="album-all" role="dialog" aria-modal="true" aria-label="全部照片">
          <div className="album-all__inner">
            <header className="album-all__head">
              <button className="icon-btn" aria-label="返回相册" onClick={closeFullGallery}>
                <Icon name="chevronLeft" size={20} />
              </button>
              <div className="album-all__title">
                <b>{filter === 'all' ? '全部照片' : `${months.find((m) => m.key === filter)?.label ?? ''}照片`}</b>
                <span>共 {visible.length} 张 · 按时间倒序</span>
              </div>
              <span className="album-all__spacer" aria-hidden="true" />
            </header>
            <div className="album-all__body">
              <div className="album-grid album-grid--rest album-grid--full">{visible.map(photoCard)}</div>
            </div>
          </div>
        </div>
      ) : null}

      {lightbox && lightboxIndex !== null ? (
        <div
          className={`lightbox-backdrop${bare ? ' lightbox--bare' : ''}`}
          onClick={() => setLightboxIndex(null)}
        >
          <div
            className={`lightbox${bare ? ' lightbox--bare' : ''}`}
            onClick={(event) => event.stopPropagation()}
          >
            <div
              ref={stageRef}
              className="lightbox__stage"
              onPointerDown={onStagePointerDown}
              onPointerMove={onStagePointerMove}
              onPointerUp={onStagePointerUp}
              onPointerCancel={onStagePointerCancel}
            >
              {lightboxStill ? (
                <div
                  key={lightbox.id}
                  className={`lightbox__slide lightbox__slide--${slideDir}`}
                >
                  <img
                    ref={lightboxImgRef}
                    className="lightbox__photo"
                    src={lightbox.src}
                    alt={lightbox.caption}
                    draggable={false}
                    onLoad={(event) =>
                      setRatio(event.currentTarget.naturalWidth / Math.max(1, event.currentTarget.naturalHeight))
                    }
                    style={{
                      transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${scale})`,
                      transition: gesturing ? 'none' : 'transform 180ms var(--ease)',
                    }}
                  />
                </div>
              ) : (
                <div
                  key={lightbox.id}
                  className={`lightbox__slide lightbox__slide--${slideDir}`}
                >
                  <LightboxMedia photo={lightbox} />
                </div>
              )}
            </div>

            {lightboxList.length > 1 && scale <= 1 && !bare && lightboxIndex > 0 ? (
              <button
                type="button"
                className="lightbox__nav lightbox__nav--prev"
                aria-label="上一张照片"
                onClick={() => stepLightbox(-1)}
              >
                <Icon name="chevronLeft" size={20} />
              </button>
            ) : null}
            {lightboxList.length > 1 && scale <= 1 && !bare && lightboxIndex < lightboxList.length - 1 ? (
              <button
                type="button"
                className="lightbox__nav lightbox__nav--next"
                aria-label="下一张照片"
                onClick={() => stepLightbox(1)}
              >
                <Icon name="chevronRight" size={20} />
              </button>
            ) : null}

            <div
              className={`lightbox__cap${lightbox.kind === 'video' ? ' lightbox__cap--video' : ''}`}
              data-photo-ink={lightboxToneOK ? lightboxTone ?? undefined : undefined}
            >
              <div className="lightbox__title-row">
                <b>{lightbox.caption}</b>
                <button
                  type="button"
                  className="lightbox__edit"
                  onClick={() => {
                    setLightboxIndex(null)
                    setCaptionEdit({ id: lightbox.id, value: lightbox.caption })
                  }}
                >
                  改标题
                </button>
                {canDelete ? (
                  <button
                    type="button"
                    className="lightbox__edit lightbox__danger"
                    onClick={() => {
                      setLightboxIndex(null)
                      setPendingDelete([lightbox.id])
                    }}
                  >
                    删除
                  </button>
                ) : null}
              </div>
              <div className="lightbox__meta">
                <span>
                  {longDate(lightbox.at)} · {lightbox.author} {lightbox.kind === 'video' ? '录制' : '拍摄'}
                </span>
                <span className="lightbox__count">
                  {lightboxIndex + 1} / {lightboxList.length}
                </span>
              </div>
            </div>
          </div>

          <button
            className="icon-btn icon-btn--light lightbox__close"
            aria-label="关闭"
            onClick={() => setLightboxIndex(null)}
          >
            <Icon name="close" size={18} />
          </button>
        </div>
      ) : null}
    </div>
  )
}


