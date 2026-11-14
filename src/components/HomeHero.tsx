import type { RefObject } from 'react'
import { NestoryMark } from '../brand/Logo'
import { Icon } from '../brand/icons'
import { HERO } from '../data/config'

export type HeroSlide = { id: string; src: string; alt: string }

type HomeHeroProps = {
  slides: HeroSlide[]
  index: number
  onIndex: (next: number) => void
  trackRef: RefObject<HTMLDivElement | null>
  imgRef: RefObject<HTMLImageElement | null>
  /** 当前照片的主色，用来让标题在照片上仍然可读 */
  tone?: string
  /** 用户手动滑动 / 按键时顺延自动轮播 */
  onPause: () => void
  onOpenSettings: () => void
  onGo: (index: number) => void
  dateLabel: string
  babyName: string
  meta: { age: string; totalDays: number } | null
  birthday: string
  quoteLabel?: string | null
  quoteText: string
}

/**
 * 首页顶部大图轮播（含品牌条、宝宝信息、每日一句、指示点）。
 *
 * 从 Home.tsx 里拆出来的纯展示层：滚动/按键只回调 `onIndex`，
 * 自动轮播的计时器留在页面里，因为「用户刚操作过就别自动翻」是页面策略。
 */
export function HomeHero({
  slides,
  index,
  onIndex,
  trackRef,
  imgRef,
  tone,
  onPause,
  onOpenSettings,
  onGo,
  dateLabel,
  babyName,
  meta,
  birthday,
  quoteLabel,
  quoteText,
}: HomeHeroProps) {
  return (
    <header className={`hero${slides.length ? '' : ' hero--empty'}`} data-photo-ink={tone}>
      <div
        className="hero__track"
        ref={trackRef}
        onScroll={(event) => {
          const track = event.currentTarget
          const next = Math.round(track.scrollLeft / track.clientWidth)
          if (next !== index) onIndex(next)
        }}
        aria-label={slides.length ? `宝宝照片，共 ${slides.length} 张` : '宝宝照片'}
        role="group"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
          event.preventDefault()
          const step = event.key === 'ArrowRight' ? 1 : -1
          const next = Math.max(0, Math.min(slides.length - 1, index + step))
          event.currentTarget.scrollTo({ left: next * event.currentTarget.clientWidth, behavior: 'smooth' })
          onIndex(next)
          onPause()
        }}
        onPointerDown={onPause}
      >
        {slides.map((photo, slideIndex) => (
          <div className="hero__slide" key={photo.id} aria-hidden={slideIndex !== index}>
            <img
              ref={slideIndex === index ? imgRef : undefined}
              className="hero__img"
              src={photo.src}
              alt={photo.alt}
              loading="eager"
              decoding="async"
              draggable={false}
            />
          </div>
        ))}
      </div>
      <div className="hero__veil" />
      {slides.length === 0 ? (
        <div className="hero__empty-mark" aria-hidden="true">
          <NestoryMark size={132} tone="light" />
        </div>
      ) : null}
      <div className="hero__top">
        <div className="hero__brand">
          <NestoryMark size={30} tone="light" />
          <span className="hero__brand-copy">
            <span className="hero__brand-name">Nestory</span>
            <span className="hero__brand-tag">{HERO.brandTag}</span>
          </span>
        </div>
        <button className="icon-btn icon-btn--light" aria-label="设置首页照片" onClick={onOpenSettings}>
          <Icon name="settings" size={19} />
        </button>
      </div>

      <div className="hero__content">
        <div className="hero__date">{dateLabel}</div>
        <h1 className="hero__name">{babyName}</h1>
        <div className="hero__meta">
          {meta ? (
            <>
              <span>{meta.age}</span>
              <i />
              <span>第 {meta.totalDays} 天</span>
              <i />
              <span>{birthday.replace(/-/g, '.')} 出生</span>
            </>
          ) : (
            <span>还没有填写出生日期，可在「我的」里补上</span>
          )}
        </div>
        {quoteLabel ? <p className="hero__occasion">{quoteLabel}</p> : null}
        <p className="hero__quote">
          <span className="hero__quote-text" key={quoteText}>
            {quoteText}
          </span>
        </p>
        <div className="hero__dots" role="group" aria-label="切换首页照片">
          {slides.map((photo, dotIndex) => (
            <button
              key={photo.id}
              type="button"
              className={`hero__dot${dotIndex === index ? ' hero__dot--on' : ''}`}
              aria-label={`第 ${dotIndex + 1} 张照片`}
              aria-current={dotIndex === index ? 'true' : undefined}
              onClick={() => onGo(dotIndex)}
            />
          ))}
        </div>
      </div>
    </header>
  )
}
