import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../brand/icons'
import type { IconName } from '../brand/icons'
import { ScreenHead, SectionHead } from '../components/Common'
import { Sheet } from '../components/Sheet'
import { useStore, uid } from '../data/store'
import type { FeedRecord } from '../data/types'
import { clock, durationLabel, minutesLabel, shortSpan, startOfDay, timeHM } from '../lib/date'
import { feedIntervals, feedStats, last7Days } from '../lib/stats'
import type { FeedKind } from '../lib/stats'
import { navigate } from '../lib/route'
import { viewerName } from '../lib/viewer'
import { FEED_DEFAULTS, FEED_METHODS, FEED_PRESETS } from '../data/config'

const METHOD_META = FEED_METHODS.reduce(
  (acc, method) => {
    acc[method.key] = { label: method.label, icon: method.icon }
    return acc
  },
  {} as Record<FeedKind, { label: string; icon: IconName }>,
)

/** HH:MM → 时间戳；base 给定时沿用那天的日期（编辑旧记录），否则用今天/昨天。 */
function timeToStart(value: string, base?: number) {
  if (!/^\d{2}:\d{2}$/.test(value)) return base ?? Date.now()
  const [h, m] = value.split(':').map(Number)
  const d = new Date(base ?? Date.now())
  d.setHours(Number.isFinite(h) ? h : 0, Number.isFinite(m) ? m : 0, 0, 0)
  let ts = d.getTime()
  if (base == null && ts > Date.now() + 60_000) ts -= 86400000
  return ts
}

function dayLabel(ts: number): string {
  const today = startOfDay(Date.now())
  const d = startOfDay(ts)
  if (d === today) return '今天'
  if (d === today - 86_400_000) return '昨天'
  const x = new Date(ts)
  return `${x.getMonth() + 1} 月 ${x.getDate()} 日`
}

function recordTitle(r: FeedRecord): string {
  const parts: string[] = []
  const sec = r.leftSec + r.rightSec
  if (sec > 0) {
    const t = sec >= 60 ? `${Math.floor(sec / 60)} 分${sec % 60 ? ` ${sec % 60} 秒` : ''}` : `${sec} 秒`
    const side = [
      r.leftSec >= 30 ? `左 ${Math.max(1, Math.round(r.leftSec / 60))}′` : null,
      r.rightSec >= 30 ? `右 ${Math.max(1, Math.round(r.rightSec / 60))}′` : null,
    ]
      .filter(Boolean)
      .join(' / ')
    parts.push(`亲喂 ${t}${side ? `（${side}）` : ''}`)
  }
  if (r.bottleMl > 0) parts.push(`瓶喂母乳 ${r.bottleMl} ml`)
  if (r.formulaMl > 0) parts.push(`配方奶 ${r.formulaMl} ml`)
  return parts.join(' · ') || '未记录内容'
}

export default function FeedPage({ mode = 'full' }: { mode?: 'full' | 'quick' }) {
  const { state, dispatch, toast } = useStore()
  const quick = mode === 'quick'
  const viewer = viewerName(state)
  const now = Date.now()
  const stats = feedStats(state.feeds, state.reminder.intervalMinutes, now)

  const [methods, setMethods] = useState<FeedKind[]>([])
  const [leftSec, setLeftSec] = useState(0)
  const [rightSec, setRightSec] = useState(0)
  const [side, setSide] = useState<'left' | 'right'>('left')
  const [running, setRunning] = useState(false)
  const [bottleMl, setBottleMl] = useState(FEED_DEFAULTS.bottleMl)
  const [formulaMl, setFormulaMl] = useState(FEED_DEFAULTS.formulaMl)
  const [feedTime, setFeedTime] = useState(timeHM(Date.now()))
  const [note, setNote] = useState('')
  const [editing, setEditing] = useState<FeedRecord | null>(null)
  const [deleting, setDeleting] = useState<FeedRecord | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const showComposer = quick || !!editing

  const lastTick = useRef(Date.now())
  const composerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!running) return
    lastTick.current = Date.now()
    const id = window.setInterval(() => {
      const t = Date.now()
      const delta = (t - lastTick.current) / 1000
      lastTick.current = t
      if (side === 'left') setLeftSec((s) => s + delta)
      else setRightSec((s) => s + delta)
    }, 250)
    return () => window.clearInterval(id)
  }, [running, side])

  const breastOn = methods.includes('breast')
  useEffect(() => {
    if (!historyOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setHistoryOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [historyOpen])

  useEffect(() => {
    if (!editing) return
    const id = window.setTimeout(() => {
      const top = Math.max(0, (composerRef.current?.offsetTop ?? 0) - 70)
      window.scrollTo({ top, behavior: 'smooth' })
    }, 40)
    return () => window.clearTimeout(id)
  }, [editing])

  const hasBreast = breastOn && leftSec + rightSec > 0
  const hasBottle = methods.includes('bottle') && bottleMl > 0
  const hasFormula = methods.includes('formula') && formulaMl > 0
  const canSave = hasBreast || hasBottle || hasFormula

  const toggleMethod = (m: FeedKind) => {
    if (methods.includes(m)) {
      setMethods(methods.filter((x) => x !== m))
      if (m === 'breast') setRunning(false)
      return
    }
    if (!editing && m !== 'breast' && !methods.some((x) => x !== 'breast')) {
      setFeedTime(timeHM(Date.now()))
    }
    setMethods([...methods, m])
  }

  const resetComposer = () => {
    setMethods([])
    setLeftSec(0)
    setRightSec(0)
    setSide('left')
    setRunning(false)
    setBottleMl(FEED_DEFAULTS.bottleMl)
    setFormulaMl(FEED_DEFAULTS.formulaMl)
    setFeedTime(timeHM(Date.now()))
    setNote('')
    setEditing(null)
  }

  const save = () => {
    if (!canSave) return
    setRunning(false)
    const breastTotal = breastOn ? Math.round(leftSec + rightSec) : 0
    const startedAt = editing
      ? timeToStart(feedTime, editing.startedAt)
      : breastTotal > 0
        ? Date.now() - breastTotal * 1000
        : timeToStart(feedTime)
    const record: FeedRecord = {
      id: editing?.id ?? uid('f'),
      startedAt,
      endedAt: breastTotal > 0 ? Date.now() : startedAt,
      leftSec: breastOn ? Math.round(leftSec) : 0,
      rightSec: breastOn ? Math.round(rightSec) : 0,
      bottleMl: methods.includes('bottle') ? bottleMl : 0,
      formulaMl: methods.includes('formula') ? formulaMl : 0,
      note: note.trim() || undefined,
      author: editing?.author ?? viewer,
      updatedAt: Date.now(),
    }
    dispatch({ type: editing ? 'updateFeed' : 'addFeed', feed: record })
    toast(editing ? '记录已更新，统计已重新计算' : `已记录喂养 · ${timeHM(record.startedAt)}`)
    resetComposer()
    if (quick) {
      navigate('home')
      return
    }
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const startEdit = (r: FeedRecord) => {
    setEditing(r)
    setRunning(false)
    setLeftSec(r.leftSec)
    setRightSec(r.rightSec)
    const ms: FeedKind[] = []
    if (r.leftSec + r.rightSec > 0) ms.push('breast')
    if (r.bottleMl > 0) ms.push('bottle')
    if (r.formulaMl > 0) ms.push('formula')
    setMethods(ms)
    setBottleMl(r.bottleMl || FEED_DEFAULTS.bottleMl)
    setFormulaMl(r.formulaMl || FEED_DEFAULTS.formulaMl)
    setFeedTime(timeHM(r.startedAt))
    setNote(r.note ?? '')
    setHistoryOpen(false)
  }

  const remove = () => {
    if (!deleting) return
    dispatch({ type: 'deleteFeed', id: deleting.id })
    toast('记录已删除，统计已重新计算')
    if (editing?.id === deleting.id) resetComposer()
    setDeleting(null)
  }

  const intervalMap = useMemo(() => {
    const m = new Map<string, number>()
    feedIntervals(state.feeds).forEach((i) => m.set(i.id, i.minutes))
    return m
  }, [state.feeds])

  const sorted = [...state.feeds].sort((a, b) => b.startedAt - a.startedAt)
  const groupRecords = (list: FeedRecord[]) => {
    const out: { label: string; items: FeedRecord[] }[] = []
    for (const r of list) {
      const label = dayLabel(r.startedAt)
      const last = out[out.length - 1]
      if (last && last.label === label) last.items.push(r)
      else out.push({ label, items: [r] })
    }
    return out
  }
  const groups = groupRecords(sorted.slice(0, 3))

  const week = last7Days(state.feeds, now)
  const maxWeek = Math.max(1, ...week.map((w) => w.count))
  const totalBreastSec = Math.round(leftSec + rightSec)

  return (
    <div className="page page--sub">
      <ScreenHead
        title={quick ? '记录喂养' : '喂养中心'}
        sub={quick ? 'QUICK LOG' : 'FEEDING'}
      />

      <div className="page__body">
        {quick ? (
          <div className="quick-context">
            <span className="quick-context__dot" aria-hidden="true" />
            <span>
              {stats.lastAt
                ? `上次 ${timeHM(stats.lastAt)} · 已过 ${minutesLabel(stats.sinceLastMin)}`
                : '今天还没有记录，从第一餐开始'}
            </span>
          </div>
        ) : (
          <div className="feed-today">
            <span className="feed-today__accent" aria-hidden="true" />
            <div className="feed-today__main">
              <div className="feed-today__title">
                今天已喂养 <b>{stats.count}</b> 次
                {stats.totalMl > 0 ? (
                  <>
                    {' · '}瓶喂 <b>{stats.totalMl}</b> ml
                  </>
                ) : null}
              </div>
              <div className="feed-today__sub">
                {stats.lastAt
                  ? `最近一次 ${timeHM(stats.lastAt)} · 已过 ${minutesLabel(stats.sinceLastMin)}`
                  : '今天还没有记录，从第一餐开始'}
              </div>
            </div>
          </div>
        )}

        {showComposer ? (
        <div className="composer" ref={composerRef}>
          {editing ? (
            <div className="divider-label" style={{ marginTop: 0 }}>
              正在编辑 {timeHM(editing.startedAt)} 的记录
              <button
                style={{ color: 'var(--forest)', textDecoration: 'underline', fontSize: 'calc(11px * var(--type-scale, 1))' }}
                onClick={resetComposer}
              >
                取消
              </button>
            </div>
          ) : (
            <div className="divider-label" style={{ marginTop: 0 }}>
              选择本次喂养方式 · 可多选
            </div>
          )}

          <div className="methods">
            {(Object.keys(METHOD_META) as FeedKind[]).map((m) => (
              <button
                key={m}
                className={`method${methods.includes(m) ? ' method--on' : ''}`}
                onClick={() => toggleMethod(m)}
                aria-pressed={methods.includes(m)}
              >
                <Icon name={METHOD_META[m].icon} size={26} />
                <span>{METHOD_META[m].label}</span>
                <Icon name="check" size={12} className="method__check" />
              </button>
            ))}
          </div>

          {methods.includes('breast') ? (
            <div className="editor">
              <div className="editor__head">
                <span className="editor__title">亲喂计时</span>
                <span className="editor__note">分钟数不换算毫升</span>
              </div>
              <div className="timer">
                <div className="timer__digits">{clock(totalBreastSec)}</div>
                <div className="timer__hint">
                  {running ? `正在记录 · ${side === 'left' ? '左侧' : '右侧'}` : '左右侧可随时切换，计时会累加'}
                </div>
                <div className="sides">
                  <button
                    className={`side${side === 'left' ? ' side--on' : ''}${running && side === 'left' ? ' side--timing' : ''}`}
                    onClick={() => setSide('left')}
                  >
                    <span className="side__label">
                      <i className="side__dot" />
                      左侧
                    </span>
                    <span className="side__time">{clock(Math.floor(leftSec))}</span>
                  </button>
                  <button
                    className={`side${side === 'right' ? ' side--on' : ''}${running && side === 'right' ? ' side--timing' : ''}`}
                    onClick={() => setSide('right')}
                  >
                    <span className="side__label">
                      <i className="side__dot" />
                      右侧
                    </span>
                    <span className="side__time">{clock(Math.floor(rightSec))}</span>
                  </button>
                </div>
                <div className="timer__actions">
                  <button
                    className={`btn ${running ? 'btn--quiet' : 'btn--primary'}`}
                    onClick={() => setRunning((r) => !r)}
                  >
                    <Icon name={running ? 'pause' : 'play'} size={15} />
                    {running ? '暂停计时' : hasBreast ? '继续计时' : '开始计时'}
                  </button>
                  <button
                    className="btn btn--champagne"
                    onClick={() => {
                      setRunning(false)
                      if (hasBreast) toast('本节已记录，可继续补充其他方式')
                    }}
                    disabled={!hasBreast}
                  >
                    <Icon name="check" size={15} />
                    结束本节
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {methods.includes('bottle') ? (
            <div className="editor">
              <div className="editor__head">
                <span className="editor__title">瓶喂母乳量</span>
                <span className="editor__note">实际喂入</span>
              </div>
              <div className="amount">
                <div className="amount__value">
                  <span className="amount__num">{bottleMl}</span>
                  <span className="amount__unit">ML</span>
                </div>
                <div className="stepper">
                  <button className="stepper__btn" onClick={() => setBottleMl((v) => Math.max(0, v - 10))} aria-label="减少 10 毫升">
                    −10
                  </button>
                  <button className="stepper__btn" onClick={() => setBottleMl((v) => v + 10)} aria-label="增加 10 毫升">
                    +10
                  </button>
                  <button className="stepper__btn" onClick={() => setBottleMl((v) => v + 30)} aria-label="增加 30 毫升">
                    +30
                  </button>
                </div>
              </div>
              <div className="quick-amounts">
                {FEED_PRESETS.map((v) => (
                  <button
                    key={v}
                    className={`chip${bottleMl === v ? ' chip--on' : ''}`}
                    onClick={() => setBottleMl(v)}
                  >
                    {v} ml
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {methods.includes('formula') ? (
            <div className="editor">
              <div className="editor__head">
                <span className="editor__title">配方奶量</span>
                <span className="editor__note">按实际喂入记录</span>
              </div>
              <div className="amount">
                <div className="amount__value">
                  <span className="amount__num">{formulaMl}</span>
                  <span className="amount__unit">ML</span>
                </div>
                <div className="stepper">
                  <button className="stepper__btn" onClick={() => setFormulaMl((v) => Math.max(0, v - 10))} aria-label="减少 10 毫升">
                    −10
                  </button>
                  <button className="stepper__btn" onClick={() => setFormulaMl((v) => v + 10)} aria-label="增加 10 毫升">
                    +10
                  </button>
                  <button className="stepper__btn" onClick={() => setFormulaMl((v) => v + 30)} aria-label="增加 30 毫升">
                    +30
                  </button>
                </div>
              </div>
              <div className="quick-amounts">
                {FEED_PRESETS.map((v) => (
                  <button
                    key={v}
                    className={`chip${formulaMl === v ? ' chip--on' : ''}`}
                    onClick={() => setFormulaMl(v)}
                  >
                    {v} ml
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {!breastOn && (methods.includes('bottle') || methods.includes('formula')) ? (
            <div className="field feed-time">
              <span className="field__label">喂养时间</span>
              <div className="feed-time__row">
                <input
                  className="input feed-time__input"
                  type="time"
                  value={feedTime}
                  onChange={(e) => setFeedTime(e.target.value)}
                />
                <button
                  type="button"
                  className="chip feed-time__now"
                  onClick={() => setFeedTime(timeHM(Date.now()))}
                >
                  现在
                </button>
              </div>
              <span className="feed-time__hint">补记时可改成实际开始时间；跨过午夜会自动归到昨天。</span>
            </div>
          ) : null}

          {methods.length === 0 ? (
            <p className="composer__hint">选择一种或多种方式后，填写奶量或开始计时。</p>
          ) : (
            <>
              <label className="field" style={{ marginTop: 15 }}>
                <span className="field__label">备注（选填）</span>
                <input
                  className="input input--dashed"
                  placeholder="例如：今天吃得很好，吃完就睡了"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </label>

              <div className="composer__meta">
                <span>
                  {(() => {
                    const preview = [
                      hasBreast ? `亲喂 ${durationLabel(totalBreastSec)}` : null,
                      methods.includes('bottle') && bottleMl > 0 ? `瓶喂 ${bottleMl} ml` : null,
                      methods.includes('formula') && formulaMl > 0 ? `配方 ${formulaMl} ml` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')
                    return preview ? (
                      <>
                        本次将记录：<b>{preview}</b>
                      </>
                    ) : breastOn ? (
                      '点击开始计时'
                    ) : (
                      '填写奶量后保存'
                    )
                  })()}
                </span>
                <span>{hasBreast ? '亲喂不计毫升' : '按开始时间统计间隔'}</span>
              </div>
            </>
          )}
        </div>
        ) : null}

        {quick ? (
          <section className="quick-recent">
            <div className="quick-recent__head">
              <span className="eyebrow">最近</span>
              <button onClick={() => navigate('feed')}>
                喂养中心
                <Icon name="chevronRight" size={13} />
              </button>
            </div>
            {sorted.slice(0, 5).map((r) => (
              <div key={r.id} className="quick-record">
                <span className="quick-record__time">{timeHM(r.startedAt)}</span>
                <span className="quick-record__title">{recordTitle(r)}</span>
              </div>
            ))}
            <p className="quick-note">保存后回到首页。统计、间隔与完整记录在喂养中心查看。</p>
          </section>
        ) : null}

        {!quick ? (
          <>
        <section className="stats-block">
          <SectionHead title="今日统计" en="Overview" />
          <div className="stat-strip">
            <div className="stat-strip__item">
              <div className="stat-strip__value">
                {stats.count}
                <small>次</small>
              </div>
              <div className="stat-strip__label">喂养次数</div>
            </div>
            <div className="stat-strip__item">
              <div className="stat-strip__value">
                {Math.round(stats.breastSec / 60)}
                <small>分</small>
              </div>
              <div className="stat-strip__label">亲喂时长</div>
            </div>
            <div className="stat-strip__item">
              <div className="stat-strip__value">
                {stats.totalMl}
                <small>ml</small>
              </div>
              <div className="stat-strip__label">瓶喂总量</div>
            </div>
            <div className="stat-strip__item">
              <div className="stat-strip__value" style={{ fontSize: 'calc(20px * var(--type-scale, 1))' }}>
                {stats.avgIntervalMin ? shortSpan(stats.avgIntervalMin) : '—'}
              </div>
              <div className="stat-strip__label">平均间隔</div>
            </div>
          </div>

          <div className="trend" style={{ marginTop: 12 }}>
            <div className="trend__head">
              <span className="trend__title">近 7 天喂养次数</span>
              <span className="trend__value">共 {week.reduce((a, b) => a + b.count, 0)} 次</span>
            </div>
            <div className="bars">
              {week.map((w, i) => (
                <div key={w.day} className="bars__col">
                  <span className="bars__value">{w.count || ''}</span>
                  <div className="bars__track">
                    <div
                      className={`bars__fill${i === week.length - 1 ? ' bars__fill--today' : ''}${
                        w.count === 0 ? ' bars__fill--zero' : ''
                      }`}
                      style={{ height: `${w.count === 0 ? 4 : Math.max(10, Math.round((w.count / maxWeek) * 58))}px` }}
                    />
                  </div>
                  <span className="bars__label">{w.label}</span>
                </div>
              ))}
            </div>
            <p className="timer__hint" style={{ textAlign: 'left', marginTop: 12 }}>
              间隔 = 本次开始时间 − 上次开始时间；深夜跨天也按真实时间计算，亲喂时长不折算毫升。
            </p>
          </div>

          <button
            className="anniversary"
            style={{ width: '100%', marginTop: 12, textAlign: 'left', background: 'var(--ivory-deep)' }}
            onClick={() => navigate('reminders')}
          >
            <Icon name="bell" size={20} />
            <span className="anniversary__text">
              <span className="anniversary__title">
                {state.reminder.enabled ? `每 ${state.reminder.intervalMinutes / 60} 小时提醒` : '提醒已关闭'}
              </span>
              <span className="anniversary__sub">
                {stats.nextReminderAt
                  ? `预计下次 ${timeHM(stats.nextReminderAt)} · 提醒仅作辅助，请以宝宝的饥饿信号为准`
                  : '记录一次喂养后自动开始计时'}
              </span>
            </span>
            <Icon name="chevronRight" size={15} style={{ color: 'var(--ink-3)' }} />
          </button>
        </section>

        <section style={{ marginTop: 28 }}>
          <SectionHead title="喂养记录" en="History" />
          {groups.length === 0 ? (
            <div className="empty">还没有喂养记录。从上方选择方式，记录第一餐。</div>
          ) : (
            groups.map((g) => (
              <div key={g.label} style={{ marginBottom: 8 }}>
                <div className="divider-label" style={{ margin: '10px 0 4px' }}>
                  {g.label}
                </div>
                <div className="records">
                  {g.items.map((r) => (
                    <div key={r.id} className="record">
                      <span className="record__time">{timeHM(r.startedAt)}</span>
                      <div className="record__main">
                        <div className="record__title">{recordTitle(r)}</div>
                        <div className="record__meta">
                          {intervalMap.has(r.id) ? `距上次 ${shortSpan(intervalMap.get(r.id)!)}` : '当日首餐'}
                          {' · '}
                          {r.author}
                          {r.note ? ` · ${r.note}` : ''}
                        </div>
                      </div>
                      <div className="record__tools">
                        <button aria-label="编辑记录" onClick={() => startEdit(r)}>
                          <Icon name="edit" size={14} />
                        </button>
                        <button aria-label="删除记录" onClick={() => setDeleting(r)}>
                          <Icon name="trash" size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
          {sorted.length > 3 ? (
            <button
              className="btn btn--quiet btn--full"
              style={{ height: 44, marginTop: 8 }}
              onClick={() => setHistoryOpen(true)}
            >
              查看全部 {sorted.length} 条记录
            </button>
          ) : null}
        </section>

        <p className="about-note">
          喂养提醒与统计只是家庭记录的辅助工具，不替代宝宝的饥饿信号，也不构成医疗建议。
        </p>
          </>
        ) : null}
      </div>

      {showComposer ? (
      <div className={`save-bar${quick ? ' save-bar--quick' : ''}`}>
        {!canSave ? (
          <div className="save-bar__hint">
            {quick ? '选择方式，填写奶量或开始计时后保存' : '选择方式后，记录时长或奶量即可保存'}
          </div>
        ) : null}
        <button className="btn btn--primary btn--full" onClick={save} disabled={!canSave}>
          <Icon name="check" size={17} />
          {editing ? '保存修改' : quick ? '保存这次喂养' : '保存记录'}
          {canSave ? (
            <span style={{ fontWeight: 400, opacity: 0.7, fontSize: 'calc(12px * var(--type-scale, 1))' }}>
              {[hasBreast
                ? totalBreastSec >= 60
                  ? `${Math.round(totalBreastSec / 60)} 分`
                  : `${totalBreastSec} 秒`
                : null, bottleMl && methods.includes('bottle') ? `${bottleMl} ml` : null]
                .filter(Boolean)
                .join(' · ')}
            </span>
          ) : null}
        </button>
      </div>
      ) : null}

      {historyOpen ? (
        <div className="history-screen" role="dialog" aria-modal="true" aria-label="全部喂养记录">
          <header className="history-screen__head">
            <button
              className="icon-btn icon-btn--plain"
              onClick={() => setHistoryOpen(false)}
              aria-label="返回喂养中心"
            >
              <Icon name="chevronLeft" size={20} />
            </button>
            <div className="history-screen__titles">
              <h2 className="history-screen__title">喂养记录</h2>
              <span className="history-screen__sub">共 {sorted.length} 条 · 按时间倒序</span>
            </div>
            <span style={{ width: 36 }} />
          </header>
          <div className="history-screen__body">
            {groupRecords(sorted).map((g) => (
              <div key={g.label} style={{ marginBottom: 10 }}>
                <div className="divider-label" style={{ margin: '14px 0 4px' }}>
                  {g.label}
                </div>
                <div className="records">
                  {g.items.map((r) => (
                    <div key={r.id} className="record">
                      <span className="record__time">{timeHM(r.startedAt)}</span>
                      <div className="record__main">
                        <div className="record__title">{recordTitle(r)}</div>
                        <div className="record__meta">
                          {intervalMap.has(r.id) ? `距上次 ${shortSpan(intervalMap.get(r.id)!)}` : '当日首餐'}
                          {' · '}
                          {r.author}
                          {r.note ? ` · ${r.note}` : ''}
                        </div>
                      </div>
                      <div className="record__tools">
                        <button aria-label="编辑记录" onClick={() => startEdit(r)}>
                          <Icon name="edit" size={14} />
                        </button>
                        <button aria-label="删除记录" onClick={() => setDeleting(r)}>
                          <Icon name="trash" size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <Sheet
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title="删除这条喂养记录？"
        desc={deleting ? `${timeHM(deleting.startedAt)} · ${recordTitle(deleting)}` : undefined}
        footer={
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn--quiet" style={{ flex: 1 }} onClick={() => setDeleting(null)}>
              保留
            </button>
            <button
              className="btn"
              style={{ flex: 1, background: 'var(--danger)', color: 'var(--ivory)' }}
              onClick={remove}
            >
              删除
            </button>
          </div>
        }
      >
        <p className="sheet__desc">
          删除后，今日次数、瓶喂量与喂养间隔会立即重新计算，且无法恢复。
        </p>
      </Sheet>
    </div>
  )
}

