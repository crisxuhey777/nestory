import { useEffect, useState } from 'react'
import { Icon } from '../brand/icons'
import { Sheet } from './Sheet'
import { useStore, uid } from '../data/store'
import type { FeedRecord } from '../data/types'
import type { FeedKind } from '../lib/stats'
import { clock, timeHM } from '../lib/date'
import { isBeforeBirth } from '../lib/birth'
import { viewerName } from '../lib/viewer'
import { FEED_DEFAULTS, FEED_METHODS, FEED_PRESETS } from '../data/config'

const MAX_ML = 999

function readMl(raw: string) {
  const digits = raw.replace(/\D/g, '').slice(0, 3)
  return digits ? Number(digits) : 0
}

function timeToStart(value: string) {
  if (!/^\d{2}:\d{2}$/.test(value)) return Date.now()
  const [h, m] = value.split(':').map(Number)
  const d = new Date()
  d.setHours(Number.isFinite(h) ? h : 0, Number.isFinite(m) ? m : 0, 0, 0)
  let ts = d.getTime()
  if (ts > Date.now() + 60_000) ts -= 86400000
  return ts
}

export function FeedSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { state, dispatch, toast } = useStore()
  const viewer = viewerName(state)

  const [methods, setMethods] = useState<FeedKind[]>([])
  const [leftSec, setLeftSec] = useState(0)
  const [rightSec, setRightSec] = useState(0)
  const [side, setSide] = useState<'left' | 'right'>('left')
  const [running, setRunning] = useState(false)
  const [breastStart, setBreastStart] = useState<number | null>(null)
  const [bottleMl, setBottleMl] = useState(FEED_DEFAULTS.bottleMl)
  const [formulaMl, setFormulaMl] = useState(FEED_DEFAULTS.formulaMl)
  const [feedTime, setFeedTime] = useState(timeHM(Date.now()))
  const [note, setNote] = useState('')

  useEffect(() => {
    if (!open) {
      setRunning(false)
      return
    }
    setMethods([])
    setLeftSec(0)
    setRightSec(0)
    setSide('left')
    setRunning(false)
    setBreastStart(null)
    setBottleMl(FEED_DEFAULTS.bottleMl)
    setFormulaMl(FEED_DEFAULTS.formulaMl)
    setFeedTime(timeHM(Date.now()))
    setNote('')
  }, [open])

  useEffect(() => {
    if (!open || !running) return
    let last = Date.now()
    const id = window.setInterval(() => {
      const now = Date.now()
      const delta = (now - last) / 1000
      last = now
      if (side === 'left') setLeftSec((sec) => sec + delta)
      else setRightSec((sec) => sec + delta)
    }, 250)
    return () => window.clearInterval(id)
  }, [open, running, side])

  const breastOn = methods.includes('breast')
  const totalBreastSec = Math.round(leftSec + rightSec)
  const hasBreast = breastOn && totalBreastSec > 0
  const hasBottle = methods.includes('bottle') && bottleMl > 0
  const hasFormula = methods.includes('formula') && formulaMl > 0
  const canSave = hasBreast || hasBottle || hasFormula

  const toggleMethod = (method: FeedKind) => {
    if (methods.includes(method)) {
      setMethods(methods.filter((m) => m !== method))
      if (method === 'breast') {
        setRunning(false)
        setBreastStart(null)
      }
      return
    }
    if (method !== 'breast' && !methods.some((m) => m !== 'breast')) {
      setFeedTime(timeHM(Date.now()))
    }
    setMethods([...methods, method])
  }

  const toggleRunning = () => {
    if (!running && breastStart == null) setBreastStart(Date.now())
    setRunning((value) => !value)
  }

  const save = () => {
    if (!canSave) return
    setRunning(false)
    const startedAt = hasBreast
      ? breastStart ?? Date.now() - totalBreastSec * 1000
      : timeToStart(feedTime)
    if (isBeforeBirth(startedAt, state.baby)) {
      toast('喂养时间不能早于宝宝的生日')
      return
    }
    if (startedAt > Date.now() + 60_000) {
      toast('喂养时间不能晚于现在')
      return
    }
    const record: FeedRecord = {
      id: uid('f'),
      startedAt,
      endedAt: hasBreast ? Date.now() : startedAt,
      leftSec: breastOn ? Math.round(leftSec) : 0,
      rightSec: breastOn ? Math.round(rightSec) : 0,
      bottleMl: methods.includes('bottle') ? bottleMl : 0,
      formulaMl: methods.includes('formula') ? formulaMl : 0,
      note: note.trim() || undefined,
      author: viewer,
      updatedAt: Date.now(),
    }
    dispatch({ type: 'addFeed', feed: record })
    toast(`已记录喂养 · ${timeHM(record.startedAt)}`)
    onClose()
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="记录喂养"
      desc="选择本次方式；亲喂可计时，瓶喂与配方奶直接填量。"
      footer={
        <button className="btn btn--primary" style={{ width: '100%' }} onClick={save} disabled={!canSave}>
          <Icon name="check" size={16} />
          保存这次喂养
        </button>
      }
    >
      <div className="methods">
        {FEED_METHODS.map((method) => (
          <button
            key={method.key}
            className={`method${methods.includes(method.key) ? ' method--on' : ''}`}
            onClick={() => toggleMethod(method.key)}
            aria-pressed={methods.includes(method.key)}
          >
            <Icon name={method.icon} size={24} />
            <span>{method.label}</span>
            <Icon name="check" size={12} className="method__check" />
          </button>
        ))}
      </div>

      {breastOn ? (
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
              <button className={`btn ${running ? 'btn--quiet' : 'btn--primary'}`} onClick={toggleRunning}>
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
            <span className="editor__note">实际喂入 · 可输入</span>
          </div>
          <div className="amount">
            <div className="amount__value">
              <input
                className="amount__num amount__input"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                aria-label="瓶喂母乳奶量，单位毫升"
                placeholder="0"
                value={bottleMl || ''}
                onChange={(e) => setBottleMl(readMl(e.target.value))}
                onFocus={(e) => e.currentTarget.select()}
                style={{ width: `${Math.max(2, String(bottleMl || 0).length)}ch` }}
              />
              <span className="amount__unit">ML</span>
            </div>
            <div className="stepper">
              <button className="stepper__btn" onClick={() => setBottleMl((v) => Math.max(0, v - 10))} aria-label="减少 10 毫升">
                −10
              </button>
              <button className="stepper__btn" onClick={() => setBottleMl((v) => Math.min(MAX_ML, v + 10))} aria-label="增加 10 毫升">
                +10
              </button>
              <button className="stepper__btn" onClick={() => setBottleMl((v) => Math.min(MAX_ML, v + 30))} aria-label="增加 30 毫升">
                +30
              </button>
            </div>
          </div>
          <div className="quick-amounts">
            {FEED_PRESETS.map((v) => (
              <button key={v} className={`chip${bottleMl === v ? ' chip--on' : ''}`} onClick={() => setBottleMl(v)}>
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
            <span className="editor__note">按实际喂入 · 可输入</span>
          </div>
          <div className="amount">
            <div className="amount__value">
              <input
                className="amount__num amount__input"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                aria-label="配方奶奶量，单位毫升"
                placeholder="0"
                value={formulaMl || ''}
                onChange={(e) => setFormulaMl(readMl(e.target.value))}
                onFocus={(e) => e.currentTarget.select()}
                style={{ width: `${Math.max(2, String(formulaMl || 0).length)}ch` }}
              />
              <span className="amount__unit">ML</span>
            </div>
            <div className="stepper">
              <button className="stepper__btn" onClick={() => setFormulaMl((v) => Math.max(0, v - 10))} aria-label="减少 10 毫升">
                −10
              </button>
              <button className="stepper__btn" onClick={() => setFormulaMl((v) => Math.min(MAX_ML, v + 10))} aria-label="增加 10 毫升">
                +10
              </button>
              <button className="stepper__btn" onClick={() => setFormulaMl((v) => Math.min(MAX_ML, v + 30))} aria-label="增加 30 毫升">
                +30
              </button>
            </div>
          </div>
          <div className="quick-amounts">
            {FEED_PRESETS.map((v) => (
              <button key={v} className={`chip${formulaMl === v ? ' chip--on' : ''}`} onClick={() => setFormulaMl(v)}>
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
            <button type="button" className="chip feed-time__now" onClick={() => setFeedTime(timeHM(Date.now()))}>
              现在
            </button>
          </div>
          <span className="feed-time__hint">补记时可改成实际开始时间；跨过午夜会自动归到昨天。</span>
        </div>
      ) : null}

      {methods.length === 0 ? (
        <p className="composer__hint">选择一种或多种方式后，填写奶量或开始计时。</p>
      ) : (
        <label className="field" style={{ marginTop: 15 }}>
          <span className="field__label">备注（选填）</span>
          <input
            className="input input--dashed"
            placeholder="例如：今天吃得很好，吃完就睡了"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
      )}
    </Sheet>
  )
}
