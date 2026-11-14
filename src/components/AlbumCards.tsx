import { useRef } from 'react'
import { Icon } from '../brand/icons'
import { usePhotoInk } from '../lib/photoTone'
import { formatClipLength, shrinkToDataURL } from '../lib/media'
import { monthDay } from '../lib/date'
import { hasMotion, isVideoPhoto, motionOf } from '../lib/photo'
import { API } from '../data/config'
import { aiPost } from '../data/api'
import type { Photo, PhotoMotion } from '../data/types'

/** 相册页里复用的卡片与灯箱媒体；从 AlbumPage 里拆出来，避免页面文件继续膨胀。 */

export async function requestCaptionTitles(src: string, hint: string): Promise<string[]> {
  const image = await shrinkToDataURL(src, 768)
  const body = await aiPost<{ titles?: unknown }>(API.aiCaption, { image, hint }, 60_000)
  const titles = Array.isArray(body.titles) ? body.titles.filter((t): t is string => typeof t === 'string') : []
  if (!titles.length) throw new Error('这次没想出合适的标题')
  return titles.slice(0, 3)
}

export function KindBadge({ photo, variant }: { photo: Photo; variant?: 'cover' }) {
  if (hasMotion(photo)) {
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

export function AlbumPhotoCard({
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
      <img
        ref={imgRef}
        src={photo.thumb || photo.src}
        alt={photo.caption}
        loading="lazy"
        decoding="async"
      />
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

export function AlbumMoreCard({
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
      <img
        ref={imgRef}
        src={photo.thumb || photo.src}
        alt=""
        aria-hidden="true"
        loading="lazy"
        decoding="async"
      />
      <span className="album-more__veil" />
      <span className="album-more__label">
        <b>more</b>
        <span>+{count} 张</span>
      </span>
    </button>
  )
}

export function LightboxMedia({ photo }: { photo: Photo }) {
  const motion = motionOf(photo)
  // 视频在保存时就已上传到媒体库，state 里存的是直链，不再走浏览器本地缓存。
  const url = motion?.video ?? photo.video ?? ''

  if (isVideoPhoto(photo)) {
    return (
      <video className="lightbox__clip" src={url} poster={photo.src} controls autoPlay playsInline />
    )
  }
  if (motion) {
    return (
      <div className="lightbox__live">
        <video className="lightbox__clip" src={url} poster={photo.src} autoPlay muted loop playsInline />
        <span className="lightbox__live-tag">live</span>
      </div>
    )
  }
  return <img src={photo.src} alt={photo.caption} />
}

export type PickMode = 'photo' | 'live' | 'video'

export type AlbumDraft = {
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
