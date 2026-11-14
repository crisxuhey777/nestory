import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../brand/icons'
import { NestoryMark } from '../brand/Logo'
import AiThinking from '../components/AiThinking'
import { SectionHead } from '../components/Common'
import { Sheet } from '../components/Sheet'
import { DiaperSheet, GrowthSheet, SleepSheet } from '../components/QuickSheets'
import { FeedSheet } from '../components/FeedSheet'
import { useStore, isAppState } from '../data/store'
import type { AppState } from '../data/types'
import { usePrefs } from '../lib/prefs'
import {
  ageBetween,
  ageLabel,
  chineseDate,
  fromISODate,
  isSameDay,
  minutesLabel,
  relativeFromNow,
  shortDate,
  timeHM,
  daysUntilAnniversary,
} from '../lib/date'
import { diaperCountsToday, feedStats, latestGrowth, previousGrowth, sleepMinutesToday } from '../lib/stats'
import { navigate } from '../lib/route'
import { usePhotoInk, usePhotoInkMap } from '../lib/photoTone'
import { API, HERO, HOME, QUICK_ACTIONS } from '../data/config'

const QUOTE_CACHE_KEY = 'nestory.dailyQuote.v1'

type DailyQuote = { date: string; text: string; label: string | null }

function dateKey(d: Date): string {
  const month = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  return `${d.getFullYear()}-${month}-${day}`
}

function quoteCacheKey(name: string, birthday: string): string {
  return `${QUOTE_CACHE_KEY}:${name}:${birthday}`
}

function readCachedQuote(name: string, birthday: string): DailyQuote | null {
  try {
    const raw = sessionStorage.getItem(quoteCacheKey(name, birthday))
    if (!raw) return null
    const cached = JSON.parse(raw) as DailyQuote
    return cached.date === dateKey(new Date()) ? cached : null
  } catch {
    return null
  }
}

const quoteInFlight = new Map<string, Promise<DailyQuote | null>>()

/** 同一天、同一宝宝只请求一次；StrictMode 的二次挂载也复用同一个 Promise。 */
function requestDailyQuote(key: string, state: AppState): Promise<DailyQuote | null> {
  const running = quoteInFlight.get(key)
  if (running) return running

  const task = (async () => {
    try {
      const res = await fetch(API.dailyQuote, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baby: state.baby,
          feeds: state.feeds,
          sleeps: state.sleeps,
          diapers: state.diapers,
        }),
      })
      if (!res.ok) return null
      const payload = await res.json()
      const raw = payload?.quote
      if (!raw || typeof raw.text !== 'string' || !raw.text.trim()) return null
      const next: DailyQuote = {
        date: typeof payload.date === 'string' ? payload.date : dateKey(new Date()),
        text: raw.text.trim(),
        label: typeof raw.label === 'string' && raw.label ? raw.label : null,
      }
      sessionStorage.setItem(key, JSON.stringify(next))
      return next
    } catch {
      /* 后端不在线时保留 HERO.quote 作为兜底 */
      return null
    }
  })()

  quoteInFlight.set(key, task)
  void task.finally(() => quoteInFlight.delete(key))
  return task
}

export default function HomePage() {
  const { state, dispatch, toast } = useStore()
  const { prefs } = usePrefs()
  const [sheet, setSheet] = useState<null | 'feed' | 'diaper' | 'sleep' | 'growth'>(null)
  const [heroSlide, setHeroSlide] = useState(0)
  const [quote, setQuote] = useState<DailyQuote | null>(() =>
    readCachedQuote(state.baby.name, state.baby.birthday),
  )
  const stateRef = useRef(state)
  useEffect(() => {
    stateRef.current = state
  }, [state])

  const quoteKey =
    state.baby.name.trim() && state.baby.birthday
      ? quoteCacheKey(state.baby.name, state.baby.birthday)
      : ''

  useEffect(() => {
    if (!quoteKey) {
      setQuote(null)
      return
    }
    const cached = readCachedQuote(state.baby.name, state.baby.birthday)
    if (cached) {
      setQuote(cached)
      return
    }
    let cancelled = false
    setQuote(null)
    void requestDailyQuote(quoteKey, stateRef.current).then((next) => {
      if (next && !cancelled) setQuote(next)
    })
    return () => {
      cancelled = true
    }
  }, [quoteKey, state.baby.name, state.baby.birthday])

  const [photoSheet, setPhotoSheet] = useState(false)
  const [photoStep, setPhotoStep] = useState<'grid' | 'pick'>('grid')
  const [slot, setSlot] = useState(0)
  const [draft, setDraft] = useState<string[]>([])
  const [ai, setAi] = useState<{ status: 'idle' | 'loading' | 'done'; title?: string; note?: string }>({
    status: 'idle',
  })
  const heroTrack = useRef<HTMLDivElement>(null)
  const pausedUntil = useRef(0)

  const heroSlides = useMemo(() => {
    const byId = new Map(state.photos.map((photo) => [photo.id, photo]))
    const ids = state.heroPhotoIds.length
      ? state.heroPhotoIds
      : state.photos.slice(0, HERO.maxPhotos).map((photo) => photo.id)
    const picked = ids.map((id) => byId.get(id)).filter((photo) => photo != null)
    if (!picked.length) return []
    return picked.map((photo) => ({
      id: photo.id,
      src: photo.src,
      alt: photo.caption || '宝宝照片',
    }))
  }, [state.photos, state.heroPhotoIds])

  const heroTones = usePhotoInkMap(
    heroSlides.map(({ id, src }) => ({ id, src })),
    heroSlides.length > 0,
  )
  const heroImgRef = useRef<HTMLImageElement>(null)
  const activeHero = heroSlides[heroSlide]
  const activeHeroInk = usePhotoInk(heroImgRef, activeHero?.id)
  const activeHeroTone = activeHeroInk ?? (activeHero ? heroTones[activeHero.id] : undefined)

  const goHero = (index: number) => {
    const track = heroTrack.current
    if (!track) return
    pausedUntil.current = Date.now() + HERO.pauseMs
    track.scrollTo({ left: index * track.clientWidth, behavior: 'smooth' })
    setHeroSlide(index)
  }

  useEffect(() => {
    if (heroSlide >= heroSlides.length) {
      heroTrack.current?.scrollTo({ left: 0 })
      setHeroSlide(0)
    }
  }, [heroSlide, heroSlides.length])

  useEffect(() => {
    const systemReduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    if (prefs.reduceMotion || systemReduced || photoSheet || heroSlides.length < 2) return
    const timer = window.setInterval(() => {
      const track = heroTrack.current
      if (!track || document.visibilityState !== 'visible') return
      if (Date.now() < pausedUntil.current) return
      const current = Math.round(track.scrollLeft / track.clientWidth)
      const next = (current + 1) % heroSlides.length
      track.scrollTo({ left: next * track.clientWidth, behavior: 'smooth' })
    }, HERO.intervalMs)
    return () => window.clearInterval(timer)
  }, [prefs.reduceMotion, photoSheet, heroSlides.length])

  const openPhotoSheet = () => {
    const available = state.heroPhotoIds.filter((id) => state.photos.some((photo) => photo.id === id))
    const fallback = state.photos.slice(0, HERO.maxPhotos).map((photo) => photo.id)
    setDraft(available.length ? available.slice(0, HERO.maxPhotos) : fallback)
    setPhotoStep('grid')
    setSlot(0)
    setPhotoSheet(true)
  }

  const openPicker = (index: number) => {
    setSlot(index)
    setPhotoStep('pick')
  }

  const chooseForSlot = (id: string) => {
    const next = [...draft]
    const existing = next.indexOf(id)
    if (existing === slot) {
      setPhotoStep('grid')
      return
    }
    if (existing >= 0) {
      if (slot < next.length) {
        next[existing] = next[slot]
        next[slot] = id
      } else {
        next.splice(existing, 1)
        next.push(id)
      }
    } else if (slot < next.length) {
      next[slot] = id
    } else {
      next.push(id)
    }
    setDraft(next.filter(Boolean).slice(0, HERO.maxPhotos))
    setPhotoStep('grid')
  }

  const savePhotos = () => {
    if (!draft.length) return
    dispatch({ type: 'setHeroPhotos', ids: draft })
    setPhotoSheet(false)
    setHeroSlide(0)
    heroTrack.current?.scrollTo({ left: 0, behavior: 'auto' })
    toast('首页照片已更新')
  }

  /** 把当前 AppState 发给后端，由大模型写一条小结；后端包回完整的 AppState 后直接接管。 */
  const generateSummary = async () => {
    if (ai.status === 'loading') return
    setAi({ status: 'loading' })
    try {
      const res = await fetch(API.aiSummary, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ state }),
      })
      if (!res.ok) {
        throw new Error('AI 暂时不可用，请稍后再试')
      }
      const payload = await res.json()
      if (!isAppState(payload.state)) throw new Error('生成失败，请稍后再试')
      dispatch({ type: 'hydrate', state: payload.state })
      setAi({
        status: 'done',
        title: typeof payload.ai?.title === 'string' ? payload.ai.title : '今日小结',
        note: typeof payload.ai?.note === 'string' ? payload.ai.note : '',
      })
      toast('AI 把今天写进了成长时间轴')
    } catch (error) {
      setAi({ status: 'idle' })
      toast(error instanceof Error ? error.message : '生成失败，再试一次')
    }
  }

  const now = Date.now()
  const hasBirth = /^\d{4}-\d{2}-\d{2}$/.test(state.baby.birthday)
  const birth = hasBirth ? new Date(fromISODate(state.baby.birthday, 6, 20)) : null
  const age = birth ? ageBetween(birth, new Date(now)) : null
  const stats = feedStats(state.feeds, state.reminder.intervalMinutes, now)
  const sleepMinutes = sleepMinutesToday(state.sleeps, now)
  const diapers = diaperCountsToday(state.diapers, now)
  const sleepSegments = state.sleeps.filter((s) => isSameDay(s.startedAt, now)).length
  const latest = latestGrowth(state.growths)
  const prev = previousGrowth(state.growths)
  const next = hasBirth ? daysUntilAnniversary(state.baby.birthday, new Date(now)) : null
  const albumPhotos = [...state.photos].sort((a, b) => b.at - a.at)
  const photos = albumPhotos.slice(0, HOME.recentPhotos)
  const photoById = new Map(albumPhotos.map((photo) => [photo.id, photo]))
  const pickerTones = usePhotoInkMap(
    albumPhotos.map((photo) => ({ id: photo.id, src: photo.thumb })),
    photoSheet,
  )
  const milestones = [...state.milestones].sort((a, b) => b.at - a.at).slice(0, HOME.milestones)
  const hasActivity =
    state.feeds.length + state.sleeps.length + state.diapers.length + state.growths.length > 0

  const remainingMin = stats.nextReminderAt ? (stats.nextReminderAt - now) / 60000 : null
  const remindProgress = stats.nextReminderAt
    ? Math.min(1, Math.max(0.04, stats.sinceLastMin / state.reminder.intervalMinutes))
    : 0

  const weightDelta =
    latest?.weightKg != null && prev?.weightKg != null ? latest.weightKg - prev.weightKg : null

  return (
    <div className="page">
      <header
        className={`hero${heroSlides.length ? '' : ' hero--empty'}`}
        data-photo-ink={activeHeroTone}
      >
        <div
          className="hero__track"
          ref={heroTrack}
          onScroll={(event) => {
            const track = event.currentTarget
            const next = Math.round(track.scrollLeft / track.clientWidth)
            if (next !== heroSlide) setHeroSlide(next)
          }}
          aria-label={heroSlides.length ? `宝宝照片，共 ${heroSlides.length} 张` : '宝宝照片'}
          role="group"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
            event.preventDefault()
            const step = event.key === 'ArrowRight' ? 1 : -1
            const next = Math.max(0, Math.min(heroSlides.length - 1, heroSlide + step))
            event.currentTarget.scrollTo({ left: next * event.currentTarget.clientWidth, behavior: 'smooth' })
            setHeroSlide(next)
            pausedUntil.current = Date.now() + HERO.pauseMs
          }}
          onPointerDown={() => {
            pausedUntil.current = Date.now() + HERO.pauseMs
          }}
        >
          {heroSlides.map((photo, index) => (
            <div className="hero__slide" key={photo.id} aria-hidden={index !== heroSlide}>
              <img
                ref={index === heroSlide ? heroImgRef : undefined}
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
        {heroSlides.length === 0 ? (
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
          <button
            className="icon-btn icon-btn--light"
            aria-label="设置首页照片"
            onClick={openPhotoSheet}
          >
            <Icon name="settings" size={19} />
          </button>
        </div>

        <div className="hero__content">
          <div className="hero__date">{chineseDate(now)}</div>
          <h1 className="hero__name">{state.baby.name.trim() || '宝宝'}</h1>
          <div className="hero__meta">
            {age ? (
              <>
                <span>{ageLabel(age)}</span>
                <i />
                <span>第 {age.totalDays} 天</span>
                <i />
                <span>{state.baby.birthday.replace(/-/g, '.')} 出生</span>
              </>
            ) : (
              <span>还没有填写出生日期，可在「我的」里补上</span>
            )}
          </div>
          {quote?.label ? <p className="hero__occasion">{quote.label}</p> : null}
          <p className="hero__quote">
            <span className="hero__quote-text" key={quote?.text ?? HERO.quote}>
              {quote?.text ?? HERO.quote}
            </span>
          </p>
          <div className="hero__dots" role="group" aria-label="切换首页照片">
            {heroSlides.map((photo, index) => (
              <button
                key={photo.id}
                type="button"
                className={`hero__dot${index === heroSlide ? ' hero__dot--on' : ''}`}
                aria-label={`第 ${index + 1} 张照片`}
                aria-current={index === heroSlide ? 'true' : undefined}
                onClick={() => goHero(index)}
              />
            ))}
          </div>
        </div>
      </header>

      <section className="quick-strip" aria-label="快速记录">
        <div className="quick">
          {QUICK_ACTIONS.map((action) => (
            <button
              key={action.key}
              className="quick__item"
              aria-label={`快速记录${action.label}`}
              onClick={() => setSheet(action.target)}
            >
              <span className="quick__circle">
                <Icon name={action.icon} size={action.key === 'feed' ? 25 : 24} />
              </span>
              <span className="quick__label">{action.label}</span>
            </button>
          ))}
        </div>
        <button
          className="overview__cta quick-strip__cta"
          aria-label="查看喂养记录"
          onClick={() => navigate('feed')}
        >
          <Icon name="clock" size={22} />
          <span className="overview__cta-main">
            <span className="overview__cta-title">喂养记录</span>
            <span className="overview__cta-sub">
              {stats.lastAt
                ? `上次 ${timeHM(stats.lastAt)} · 已过 ${minutesLabel(stats.sinceLastMin)}`
                : '还没有记录，从第一餐开始'}
            </span>
          </span>
          <Icon name="arrowRight" size={18} />
        </button>
      </section>

      <section className="overview" aria-label="今日成长摘要">
        <div className="overview__head">
          <span className="overview__title">今日成长摘要</span>
        </div>
        <div className="overview__grid">
          <div className="overview__cell">
            <div className="overview__value">
              {stats.count}
              <small>次</small>
            </div>
            <div className="overview__label">今日喂养</div>
          </div>
          <div className="overview__cell">
            <div className="overview__value">
              {stats.totalMl}
              <small>ml</small>
            </div>
            <div className="overview__label">瓶喂记录量</div>
          </div>
          <div className="overview__cell">
            <div className="overview__value" style={{ fontSize: 'calc(19px * var(--type-scale, 1))', letterSpacing: 0 }}>
              {stats.lastAt ? relativeFromNow(stats.lastAt, now) : '还没有'}
            </div>
            <div className="overview__label">
              最近喂养{stats.lastAt ? ` · ${timeHM(stats.lastAt)}` : ''}
            </div>
          </div>
          <div className="overview__cell">
            {latest?.weightKg != null ? (
              <div className="overview__value">
                {latest.weightKg.toFixed(1)}
                <small>kg</small>
              </div>
            ) : (
              <div className="overview__value" style={{ fontSize: 'calc(19px * var(--type-scale, 1))', letterSpacing: 0 }}>
                还没有
              </div>
            )}
            <div className="overview__label">
              最近体重{weightDelta ? ` · 较上次 +${weightDelta.toFixed(1)}` : ''}
            </div>
          </div>
          <div className="overview__cell">
            <div className="overview__value">
              {Math.floor(sleepMinutes / 60)}
              <small>小时</small>
              {Math.round(sleepMinutes % 60)}
              <small>分</small>
            </div>
            <div className="overview__label">今日睡眠 · {sleepSegments} 段</div>
          </div>
          <div className="overview__cell">
            <div className="overview__value">
              {diapers.total}
              <small>次</small>
            </div>
            <div className="overview__label">
              今日尿布 · 湿 {diapers.wet} / 脏 {diapers.dirty}
            </div>
          </div>
        </div>

        {state.reminder.enabled && stats.nextReminderAt ? (
          <button
            type="button"
            className="overview__remind"
            onClick={() => navigate('reminders', 'home')}
            aria-label="打开提醒中心"
          >
            <Icon name="clock" size={13} />
            <span>
              下次提醒 <b>{remainingMin != null && remainingMin > 0 ? `${minutesLabel(remainingMin)}后` : '现在'}</b>
            </span>
            <span className="overview__bar">
              <span style={{ width: `${remindProgress * 100}%` }} />
            </span>
          </button>
        ) : null}

      </section>

      <section className="section" style={{ marginTop: 26, display: hasActivity ? undefined : 'none' }}>
        <div className={`ai-card${ai.status === 'done' ? ' ai-card--done' : ''}`}>
          <div className="ai-card__head">
            <span className="ai-card__badge">
              <Icon name="sparkle" size={13} /> AI 小结
            </span>
            <span className="ai-card__hint">来自今天的记录</span>
          </div>

          {ai.status === 'done' ? (
            <>
              <h2 className="ai-card__title">{ai.title}</h2>
              <p className="ai-card__note">{ai.note}</p>
              <div className="ai-card__foot">
                <span className="ai-card__saved">
                  <Icon name="check" size={12} /> 已加入成长时间轴
                </span>
                <button type="button" className="ai-card__again" onClick={generateSummary}>
                  再写一条
                </button>
              </div>
            </>
          ) : (
            <>
              <h2 className="ai-card__title">让{state.baby.name}的一天，被记住</h2>
              <p className="ai-card__note">根据今天的喂养、睡眠和尿布，写一句温柔的小结，存进成长时间轴。</p>
              <button
                type="button"
                className="ai-card__cta"
                onClick={generateSummary}
                disabled={ai.status === 'loading'}
              >
                <Icon name="sparkle" size={16} />
                {ai.status === 'loading' ? '正在写…' : '生成今日小结'}
              </button>
            </>
          )}
        </div>
      </section>

      <section className="section" style={{ marginTop: 30 }}>
        <SectionHead title="最近的成长瞬间" en="Recent moments" action="全部照片" onAction={() => navigate('album')} />
        {photos.length ? (
          <div className="strip">
            {photos.map((p) => (
              <button key={p.id} className="strip__item" onClick={() => navigate('album')} aria-label={p.caption}>
                <img src={p.thumb} alt={p.caption} loading="lazy" />
                {p.kind === 'video' ? (
                  <span className="strip__badge">
                    <Icon name="play" size={8} />
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        ) : (
          <button className="home-empty" type="button" onClick={() => navigate('album')}>
            <Icon name="camera" size={20} />
            <span>还没有照片，去相册放进第一张</span>
          </button>
        )}
      </section>

      <section className="section" style={{ marginTop: 30 }}>
        <SectionHead title="成长时间轴" en="Milestones" action="完整记录" onAction={() => navigate('growth')} />
        <div className="story">
          {milestones.map((m) => (
            <div key={m.id} className="story__item">
              <span className={`story__dot${m.kind === 'anniversary' ? ' story__dot--hollow' : ''}`} />
              <span className="story__text">{m.title}</span>
              <span className="story__date">{shortDate(m.at)}</span>
            </div>
          ))}
          {milestones.length === 0 ? (
            <button className="home-empty home-empty--plain" type="button" onClick={() => navigate('album')}>
              还没有里程碑，把第一次翻身、第一颗牙记下来
            </button>
          ) : null}
        </div>
      </section>

      {next ? (
        <section className="section" style={{ marginTop: 24 }}>
          <button className="anniversary" onClick={() => navigate('album')} style={{ width: '100%', textAlign: 'left' }}>
            <span className="anniversary__num">
              {next.days}
              <small>天</small>
            </span>
            <span className="anniversary__text">
              <span className="anniversary__title">距离{next.label}</span>
              <span className="anniversary__sub">在那一天，留下一张照片和一句话</span>
            </span>
            <Icon name="chevronRight" size={16} style={{ color: 'var(--ink-3)' }} />
          </button>
        </section>
      ) : null}

      <footer className="home-foot">
        <div className="home-foot__mark">
          <NestoryMark size={20} />
          <span style={{ fontFamily: 'var(--font-serif)', fontSize: 'calc(12px * var(--type-scale, 1))', color: 'var(--forest)' }}>Nestory</span>
        </div>
        <p className="home-foot__text">A little nest. A lifetime of stories.</p>
      </footer>

      <Sheet
        open={photoSheet}
        onClose={() => setPhotoSheet(false)}
        title={photoStep === 'grid' ? '首页照片' : `选择第 ${slot + 1} 格`}
        desc={
          photoStep === 'grid'
            ? `从成长相册里选 ${HERO.maxPhotos} 张照片，按编号每 ${HERO.intervalMs / 1000} 秒轮播；点照片可以更换。`
            : '从成长相册里已有的照片中选一张；需要新照片请先去相册添加。'
        }
        footer={
          photoStep === 'grid' ? (
            <div className="hero-pick-foot">
              <button
                className="btn btn--quiet"
                onClick={() =>
                  setDraft(albumPhotos.slice(0, HERO.maxPhotos).map((photo) => photo.id))
                }
                type="button"
              >
                恢复默认
              </button>
              <button className="btn btn--primary" onClick={savePhotos} disabled={!draft.length} type="button">
                保存照片
              </button>
            </div>
          ) : undefined
        }
      >
        {photoStep === 'grid' ? (
          <>
            <div className="hero-pick-head">
              <span className="eyebrow">已选 {draft.length} / {HERO.maxPhotos}</span>
              <span className="hero-pick-tip">按编号顺序轮播</span>
            </div>
            <div className="hero-grid">
              {Array.from({ length: HERO.maxPhotos }, (_, index) => {
                const id = draft[index]
                const photo = id ? photoById.get(id) : undefined
                if (photo) {
                  return (
                    <button
                      key={photo.id}
                      type="button"
                      className="hero-cell"
                      data-photo-ink={pickerTones[photo.id]}
                      onClick={() => openPicker(index)}
                      aria-label={`第 ${index + 1} 张，${photo.caption}，点击更换`}
                    >
                      <img src={photo.thumb} alt="" loading="lazy" />
                      <span className="hero-cell__no">{index + 1}</span>
                      <span className="hero-cell__cap">{photo.caption}</span>
                    </button>
                  )
                }
                if (index === draft.length) {
                  return (
                    <button
                      key={`add-${index}`}
                      type="button"
                      className="hero-cell hero-cell--add"
                      onClick={() => openPicker(index)}
                      aria-label={`添加第 ${index + 1} 张照片`}
                    >
                      <span className="hero-cell__plus">
                        <Icon name="plus" size={22} />
                      </span>
                      <span className="hero-cell__add">从相册选择</span>
                    </button>
                  )
                }
                return (
                  <button
                    key={`empty-${index}`}
                    type="button"
                    className="hero-cell hero-cell--ghost"
                    disabled
                    aria-label={`第 ${index + 1} 格，请先填满前面的格子`}
                  >
                    第 {index + 1} 格
                  </button>
                )
              })}
            </div>
            <p className="hero-pick-tip hero-pick-tip--foot">按编号顺序每 {HERO.intervalMs / 1000} 秒轮播 · 至少保留 1 张</p>
          </>
        ) : (
          <>
            <div className="hero-pick-nav">
              <button className="hero-pick-back" type="button" onClick={() => setPhotoStep('grid')}>
                <Icon name="chevronLeft" size={14} />
                返回四宫格
              </button>
              {draft[slot] ? (
                <button
                  className="hero-pick-clear"
                  type="button"
                  onClick={() => {
                    if (draft.length <= 1) {
                      toast('至少保留一张首页照片')
                      return
                    }
                    setDraft(draft.filter((_, index) => index !== slot))
                    setPhotoStep('grid')
                  }}
                >
                  清空这一格
                </button>
              ) : null}
            </div>
            <div className="hero-pick-grid">
              {albumPhotos.map((photo) => {
                const current = draft[slot] === photo.id
                const used = draft.indexOf(photo.id)
                return (
                  <button
                    key={photo.id}
                    type="button"
                    className={`hero-pick${current ? ' hero-pick--on' : ''}`}
                    data-photo-ink={pickerTones[photo.id]}
                    onClick={() => chooseForSlot(photo.id)}
                    aria-pressed={current}
                    aria-label={`${photo.caption}${used >= 0 ? `，当前第 ${used + 1} 张` : ''}`}
                  >
                    <img src={photo.thumb} alt="" loading="lazy" />
                    {current ? (
                      <span className="hero-pick__no">
                        <Icon name="check" size={10} />
                      </span>
                    ) : used >= 0 ? (
                      <span className="hero-pick__no hero-pick__no--soft">{used + 1}</span>
                    ) : null}
                    <span className="hero-pick__cap">{photo.caption}</span>
                  </button>
                )
              })}
            </div>
            <p className="hero-pick-tip hero-pick-tip--foot">
              点击照片放入第 {slot + 1} 格；已选照片会自动交换位置。
            </p>
          </>
        )}
      </Sheet>

      <FeedSheet open={sheet === 'feed'} onClose={() => setSheet(null)} />
      <DiaperSheet open={sheet === 'diaper'} onClose={() => setSheet(null)} />
      <SleepSheet open={sheet === 'sleep'} onClose={() => setSheet(null)} />
      <GrowthSheet open={sheet === 'growth'} onClose={() => setSheet(null)} />

      {ai.status === 'loading' ? <AiThinking name={state.baby.name} /> : null}
    </div>
  )
}
