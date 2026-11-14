import type { RefObject } from 'react'
import { Icon } from '../brand/icons'
import type { Photo } from '../data/types'
import { longDate } from '../lib/date'
import { LightboxMedia } from './AlbumCards'
import type { useLightboxZoom } from './useLightboxZoom'

type LightboxZoom = ReturnType<typeof useLightboxZoom>

type AlbumLightboxProps = {
  photo: Photo
  index: number
  /** 当前查看的是否为静态照片（视频 / 动态照片走视频播放器） */
  still: boolean
  total: number
  step: (delta: number) => void
  bare: boolean
  slideDir: 'next' | 'prev'
  zoom: LightboxZoom
  onRatio: (ratio: number) => void
  /** 图片主色，只在静态照片上生效 */
  tone?: string
  canWrite: boolean
  canDelete: boolean
  imgRef: RefObject<HTMLImageElement | null>
  onClose: () => void
  onEdit: () => void
  onDelete: () => void
}

/**
 * 相册灯箱：背景遮罩、手势舞台、上一张/下一张、底部标题栏。
 *
 * 从 Album.tsx 里拆出的展示层；缩放/平移由 `useLightboxZoom` 提供，
 * 这里只把它的 handlers 挂到舞台上。
 */
export function AlbumLightbox({
  photo,
  index,
  still,
  total,
  step,
  bare,
  slideDir,
  zoom,
  onRatio,
  tone,
  canWrite,
  canDelete,
  imgRef,
  onClose,
  onEdit,
  onDelete,
}: AlbumLightboxProps) {
  return (
    <div className={`lightbox-backdrop${bare ? ' lightbox--bare' : ''}`} onClick={onClose}>
      <div className={`lightbox${bare ? ' lightbox--bare' : ''}`} onClick={(event) => event.stopPropagation()}>
        <div
          ref={zoom.stageRef}
          className="lightbox__stage"
          onPointerDown={zoom.handlers.onPointerDown}
          onPointerMove={zoom.handlers.onPointerMove}
          onPointerUp={zoom.handlers.onPointerUp}
          onPointerCancel={zoom.handlers.onPointerCancel}
        >
          {still ? (
            <div key={photo.id} className={`lightbox__slide lightbox__slide--${slideDir}`}>
              <img
                ref={imgRef}
                className="lightbox__photo"
                src={photo.src}
                alt={photo.caption}
                draggable={false}
                onLoad={(event) =>
                  onRatio(event.currentTarget.naturalWidth / Math.max(1, event.currentTarget.naturalHeight))
                }
                style={{
                  transform: `translate3d(${zoom.offset.x}px, ${zoom.offset.y}px, 0) scale(${zoom.scale})`,
                  transition: zoom.gesturing ? 'none' : 'transform 180ms var(--ease)',
                }}
              />
            </div>
          ) : (
            <div key={photo.id} className={`lightbox__slide lightbox__slide--${slideDir}`}>
              <LightboxMedia photo={photo} />
            </div>
          )}
        </div>

        {total > 1 && zoom.scale <= 1 && !bare && index > 0 ? (
          <button
            type="button"
            className="lightbox__nav lightbox__nav--prev"
            aria-label="上一张照片"
            onClick={() => step(-1)}
          >
            <Icon name="chevronLeft" size={20} />
          </button>
        ) : null}
        {total > 1 && zoom.scale <= 1 && !bare && index < total - 1 ? (
          <button
            type="button"
            className="lightbox__nav lightbox__nav--next"
            aria-label="下一张照片"
            onClick={() => step(1)}
          >
            <Icon name="chevronRight" size={20} />
          </button>
        ) : null}

        <div
          className={`lightbox__cap${photo.kind === 'video' ? ' lightbox__cap--video' : ''}`}
          data-photo-ink={tone ?? undefined}
        >
          <div className="lightbox__title-row">
            <b>{photo.caption}</b>
            {canWrite ? (
              <button type="button" className="lightbox__edit" onClick={onEdit}>
                改标题
              </button>
            ) : null}
            {canDelete ? (
              <button type="button" className="lightbox__edit lightbox__danger" onClick={onDelete}>
                删除
              </button>
            ) : null}
          </div>
          <div className="lightbox__meta">
            <span>
              {longDate(photo.at)} · {photo.author} {photo.kind === 'video' ? '录制' : '拍摄'}
            </span>
            <span className="lightbox__count">
              {index + 1} / {total}
            </span>
          </div>
        </div>
      </div>

      <button className="icon-btn icon-btn--light lightbox__close" aria-label="关闭" onClick={onClose}>
        <Icon name="close" size={18} />
      </button>
    </div>
  )
}
