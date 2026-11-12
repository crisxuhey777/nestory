import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../brand/icons'
import { TabHead, SectionHead } from '../components/Common'
import { AlbumAiCard } from '../components/AiPanels'
import { Sheet } from '../components/Sheet'
import { useStore, uid } from '../data/store'
import { ageBetween, fromISODate, longDate, monthDay, monthLabel } from '../lib/date'
import { formatClipLength, inspectVideo, uploadClip, uploadPhoto, useClipURL } from '../lib/media'
import { viewerName } from '../lib/viewer'
import type { Photo } from '../data/types'
import { MEDIA_GROUPS, MEDIA_LIMITS } from '../data/config'
import { ApiError } from '../data/api'

/** Badge for a motion clip: LIVE for live photos, length for videos. */
function KindBadge({ photo, variant }: { photo: Photo; variant?: 'cover' }) {
  if (photo.kind === 'live') {
    return (
      <span className={`album-badge album-badge--live${variant === 'cover' ? ' album-badge--cover' : ''}`}>
        <span className="album-badge__dot" />
        LIVE
      </span>
    )
  }
  if (photo.kind === 'video') {
    return (
      <span className={`album-badge${variant === 'cover' ? ' album-badge--cover' : ''}`}>
        <Icon name="play" size={9} />
        {formatClipLength(photo.durationSec) || '视频'}
      </span>
    )
  }
  return null
}

function LightboxMedia({ photo }: { photo: Photo }) {
  const url = useClipURL(photo.videoId, photo.video)

  if (photo.kind === 'video') {
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
  if (photo.kind === 'live') {
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
        <span className="lightbox__live-tag">LIVE</span>
      </div>
    )
  }
  return <img src={photo.src} alt={photo.caption} />
}

type PickMode = 'photo' | 'live' | 'video'

export default function AlbumPage() {
  const { state, dispatch, toast } = useStore()
  const viewer = viewerName(state)
  const [filter, setFilter] = useState<'all' | string>('all')
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const photoRef = useRef<HTMLInputElement>(null)
  const photoCamRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<HTMLInputElement>(null)

  const videoCamRef = useRef<HTMLInputElement>(null)
  const liveRef = useRef<HTMLInputElement>(null)
  const liveCamRef = useRef<HTMLInputElement>(null)

  const mediaRefs = {
    photoLibrary: photoRef,
    photoCamera: photoCamRef,
    videoLibrary: videoRef,
    videoCamera: videoCamRef,
    liveLibrary: liveRef,
    liveCamera: liveCamRef,
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

  const lightbox = lightboxIndex === null ? null : visible[lightboxIndex] ?? null
  const touchStart = useRef<{ x: number; y: number } | null>(null)
  const swiped = useRef(false)
  const swipedAt = useRef(0)

  const stepLightbox = (delta: number) => {
    if (visible.length < 2) return
    setLightboxIndex((current) => {
      if (current === null) return current
      return (current + delta + visible.length) % visible.length
    })
  }

  const openLightbox = (photo: Photo) => {
    const index = visible.findIndex((p) => p.id === photo.id)
    setLightboxIndex(index >= 0 ? index : 0)
  }

  useEffect(() => {
    if (lightboxIndex === null) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setLightboxIndex(null)
      if (event.key === 'ArrowLeft') stepLightbox(-1)
      if (event.key === 'ArrowRight') stepLightbox(1)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [lightboxIndex, visible.length])

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
          monthIndex: ageBetween(new Date(fromISODate(state.baby.birthday)), d).months + 1,
          items: [p],
        })
    }
    return out
  }, [visible, state.baby.birthday])

  const onPick = async (file: File | undefined, mode: PickMode, input: HTMLInputElement) => {
    if (!file || busy) return
    setBusy(true)
    try {
      if (mode === 'photo') {
        const { url, thumb } = await uploadPhoto(file)
        dispatch({
          type: 'addPhoto',
          photo: {
            id: uid('ph'),
            src: url,
            thumb,
            at: Date.now(),
            caption: '今天的模样',
            author: viewer,
            kind: 'photo',
          },
        })
        toast('照片已加入相册')
      } else {
        if (file.size > MEDIA_LIMITS.videoMaxMB * 1024 * 1024) {
          toast(`这段视频超过 ${MEDIA_LIMITS.videoMaxMB} MB，换一段短一些的`)
          return
        }
        const info = await inspectVideo(file)
        const { url, poster } = await uploadClip(file, info, mode)
        dispatch({
          type: 'addPhoto',
          photo: {
            id: uid('ph'),
            src: poster,
            thumb: poster,
            at: Date.now(),
            caption: mode === 'live' ? '会动的瞬间' : '一段小视频',
            author: viewer,
            kind: mode,
            video: url,
            durationSec: info.durationSec,
          },
        })
        toast(mode === 'live' ? 'Live 照片已加入相册' : '视频已加入相册')
      }
      setFilter('all')
      setAddOpen(false)
    } catch (error) {
      toast(error instanceof ApiError ? error.message : '这个文件暂时无法读取')
    } finally {
      setBusy(false)
      input.value = ''
    }
  }

  const milestones = [...state.milestones].sort((a, b) => b.at - a.at)
  const cover = visible[0] ?? null
  const scope = months.find((m) => m.key === filter)
  const restGroups = groups
    .map((g) => ({
      ...g,
      items: g.items.filter((p) => p.id !== cover?.id),
    }))
    .filter((g) => g.items.length > 0)

  return (
    <div className="page">
      <TabHead
        en="FAMILY ALBUM"
        title="成长相册"
        meta={
          filter === 'all'
            ? `${photos.length} 个瞬间 · ${months.length} 个月`
            : `${visible.length} 个瞬间 · ${scope?.label ?? ''}`
        }
        right={
          <button className="icon-btn" aria-label="添加到相册" onClick={() => setAddOpen(true)}>
            <Icon name="plus" size={19} />
          </button>
        }
      />

      <div className="page__body">
        {cover ? (
          <button className="album-cover" onClick={() => openLightbox(cover)}>
            <img src={cover.src} alt={cover.caption} />
            <span className="album-cover__veil" />
            <span className="album-cover__tag">{filter === 'all' ? '最近的一张' : scope?.label}</span>
            <KindBadge photo={cover} variant="cover" />
            <span className="album-cover__cap">
              <b>{cover.caption}</b>
              <span>
                {longDate(cover.at)} · {cover.author} {cover.kind === 'video' ? '录制' : '拍摄'}
                {cover.kind === 'live' ? ' · 会动' : ''}
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
            点击右上角，放入第一张照片、Live 或视频。
          </div>
        ) : (
          restGroups.map((g) => (
            <section key={g.key}>
              <div className="months">
                <span className="months__title">{g.label}</span>
                <span className="months__sub">
                  第 {g.monthIndex} 个月 · {groups.find((x) => x.key === g.key)?.items.length ?? g.items.length} 张
                </span>
              </div>
              <div className={`album-grid${cover && g.key === groups[0]?.key ? ' album-grid--rest' : ''}`}>
                {g.items.map((p) => (
                  <button key={p.id} className="album-card" onClick={() => openLightbox(p)}>
                    <img src={p.thumb} alt={p.caption} loading="lazy" />
                    <span className="album-card__veil" />
                    <KindBadge photo={p} />
                    <span className="album-card__cap">
                      <b>{p.caption}</b>
                      <span>{monthDay(p.at)}</span>
                    </span>
                  </button>
                ))}
              </div>
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
      </div>

      <Sheet
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="添加到相册"
        desc="照片会留在这里，Live 与视频会让某一天重新动起来。"
        footer={
          <p className="media-note">
            Live 照片请选择 iOS 导出的 .mov 短片，Nestory 会截取一帧作封面，查看时循环播放。视频保存在本机浏览器中。
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

      <input
        ref={photoRef}
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={(e) => onPick(e.target.files?.[0], 'photo', e.target)}
      />
      <input
        ref={photoCamRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        onChange={(e) => onPick(e.target.files?.[0], 'photo', e.target)}
      />
      <input
        ref={videoRef}
        type="file"
        accept="video/*"
        className="sr-only"
        onChange={(e) => onPick(e.target.files?.[0], 'video', e.target)}
      />
      <input
        ref={videoCamRef}
        type="file"
        accept="video/*"
        capture="environment"
        className="sr-only"
        onChange={(e) => onPick(e.target.files?.[0], 'video', e.target)}
      />
      <input
        ref={liveRef}
        type="file"
        accept="video/*,.mov"
        className="sr-only"
        onChange={(e) => onPick(e.target.files?.[0], 'live', e.target)}
      />
      <input
        ref={liveCamRef}
        type="file"
        accept="video/*"
        capture="environment"
        className="sr-only"
        onChange={(e) => onPick(e.target.files?.[0], 'live', e.target)}
      />

      {lightbox && lightboxIndex !== null ? (
        <div
          className="lightbox-backdrop"
          onClick={() => {
            if (swiped.current || Date.now() - swipedAt.current < 600) {
              swiped.current = false
              return
            }
            setLightboxIndex(null)
          }}
        >
          <div
            className="lightbox"
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => {
              if (e.pointerType !== 'touch') return
              touchStart.current = { x: e.clientX, y: e.clientY }
              swiped.current = false
            }}
            onPointerUp={(e) => {
              if (e.pointerType !== 'touch') return
              const start = touchStart.current
              touchStart.current = null
              if (!start) return
              const dx = e.clientX - start.x
              const dy = e.clientY - start.y
              if (Math.abs(dx) > 44 && Math.abs(dx) > Math.abs(dy) * 1.2) {
                swiped.current = true
                swipedAt.current = Date.now()
                stepLightbox(dx < 0 ? 1 : -1)
              }
            }}
          >
            {visible.length > 1 ? (
              <button
                type="button"
                className="lightbox__nav lightbox__nav--prev"
                aria-label="上一张照片"
                onClick={() => stepLightbox(-1)}
              >
                <Icon name="chevronLeft" size={20} />
              </button>
            ) : null}
            <LightboxMedia key={lightbox.id} photo={lightbox} />
            {visible.length > 1 ? (
              <button
                type="button"
                className="lightbox__nav lightbox__nav--next"
                aria-label="下一张照片"
                onClick={() => stepLightbox(1)}
              >
                <Icon name="chevronRight" size={20} />
              </button>
            ) : null}
            <div className="lightbox__cap">
              <b>{lightbox.caption}</b>
              <div className="lightbox__meta">
                <span>
                  {longDate(lightbox.at)} · {lightbox.author} {lightbox.kind === 'video' ? '录制' : '拍摄'}
                </span>
                <span className="lightbox__count">
                  {lightboxIndex + 1} / {visible.length}
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
