import { useEffect, useState } from 'react'
import { Sheet } from './Sheet'
import { Icon } from '../brand/icons'
import { uid, useStore } from '../data/store'
import { DAY, timeHM, toISODate } from '../lib/date'
import { isBeforeBirth } from '../lib/birth'

function atDateTime(dateValue: string, timeValue: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) return null
  if (!/^\d{2}:\d{2}$/.test(timeValue)) return null
  const t = new Date(`${dateValue}T${timeValue}:00`).getTime()
  return Number.isFinite(t) ? t : null
}

export function DiaperSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { state, dispatch, toast } = useStore()
  const add = (kind: 'wet' | 'dirty' | 'both', label: string) => {
    if (isBeforeBirth(Date.now(), state.baby)) {
      toast('尿布记录不能早于宝宝的生日')
      return
    }
    dispatch({ type: 'addDiaper', diaper: { id: uid('d'), at: Date.now(), kind } })
    toast(`已记录 · ${label} · ${timeHM(Date.now())}`)
    onClose()
  }
  return (
    <Sheet open={open} onClose={onClose} title="记录尿布" desc="选择本次更换的情况，记录会自动归入今天。">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
        {(
          [
            { kind: 'wet', label: '小便', icon: 'drop' },
            { kind: 'dirty', label: '大便', icon: 'diaper' },
            { kind: 'both', label: '混合', icon: 'both' },
          ] as const
        ).map((o) => (
          <button
            key={o.kind}
            className="method"
            style={{ padding: '18px 4px 14px' }}
            onClick={() => add(o.kind, o.label)}
          >
            <Icon name={o.icon} size={28} />
            <span>{o.label}</span>
          </button>
        ))}
      </div>
      <p className="about-note" style={{ marginTop: 16 }}>
        颜色、性状异常或伴随发热时，请及时咨询儿科医生。
      </p>
    </Sheet>
  )
}

export function SleepSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { state, dispatch, toast } = useStore()
  const ongoing = state.sleeps.find((s) => !s.endedAt)
  const initialStart = Date.now() - 30 * 60_000
  const [startDate, setStartDate] = useState(toISODate(initialStart))
  const [startTime, setStartTime] = useState(timeHM(initialStart))
  const [endDate, setEndDate] = useState(toISODate(Date.now()))
  const [endTime, setEndTime] = useState(timeHM(Date.now()))

  useEffect(() => {
    if (!open) return
    const start = Date.now() - 30 * 60_000
    const end = Date.now()
    setStartDate(toISODate(start))
    setStartTime(timeHM(start))
    setEndDate(toISODate(end))
    setEndTime(timeHM(end))
  }, [open])

  const save = () => {
    const startAt = atDateTime(startDate, startTime)
    const endAt = atDateTime(endDate, endTime)
    if (startAt == null || endAt == null) {
      toast('请填写开始与结束的日期和时间')
      return
    }
    if (endAt <= startAt) {
      toast('结束时间需要晚于开始时间')
      return
    }
    if (endAt - startAt > DAY) {
      toast('单次睡眠不能超过 24 小时')
      return
    }
    if (isBeforeBirth(startAt, state.baby)) {
      toast('睡眠开始时间不能早于宝宝的生日')
      return
    }
    if (startAt > Date.now() + 60_000 || endAt > Date.now() + 60_000) {
      toast('睡眠时间不能晚于现在')
      return
    }
    dispatch({
      type: 'addSleep',
      sleep: { id: uid('s'), startedAt: startAt, endedAt: endAt },
    })
    toast(`已记录睡眠 · ${timeHM(startAt)} – ${timeHM(endAt)}`)
    onClose()
  }

  const finishOngoing = () => {
    if (!ongoing) return
    const endAt = atDateTime(endDate, endTime)
    if (endAt == null) {
      toast('请填写结束的日期与时间')
      return
    }
    if (endAt <= ongoing.startedAt) {
      toast('结束时间需要晚于开始时间')
      return
    }
    if (endAt > Date.now() + 60_000) {
      toast('结束时间不能晚于现在')
      return
    }
    dispatch({ type: 'endSleep', id: ongoing.id, endedAt: endAt })
    toast('睡眠已补充结束时间')
    onClose()
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={ongoing ? '补充结束时间' : '记录睡眠'}
      desc={
        ongoing
          ? `这段睡眠从 ${timeHM(ongoing.startedAt)} 开始，还没有结束时间。`
          : '填写开始与结束时间即可补记，不需要一直计时。'
      }
      footer={
        <button className="btn btn--primary btn--full" onClick={ongoing ? finishOngoing : save}>
          {ongoing ? '保存结束时间' : '保存睡眠记录'}
        </button>
      }
    >
      {ongoing ? (
        <div className="sleep-when">
          <label className="sleep-when__field">
            <span>结束日期</span>
            <input
              className="input"
              type="date"
              value={endDate}
              min={state.baby.birthday || undefined}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </label>
          <label className="sleep-when__field">
            <span>结束时间</span>
            <input
              className="input"
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
            />
          </label>
        </div>
      ) : (
        <>
          <div className="sleep-when">
            <label className="sleep-when__field">
              <span>开始日期</span>
              <input
                className="input"
                type="date"
                value={startDate}
                min={state.baby.birthday || undefined}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </label>
            <label className="sleep-when__field">
              <span>开始时间</span>
              <input
                className="input"
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
              />
            </label>
          </div>

          <div className="sleep-when">
            <label className="sleep-when__field">
              <span>结束日期</span>
              <input
                className="input"
                type="date"
                value={endDate}
                min={state.baby.birthday || undefined}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </label>
            <label className="sleep-when__field">
              <span>结束时间</span>
              <input
                className="input"
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
              />
            </label>
          </div>

          <p className="timer__hint" style={{ textAlign: 'left', marginTop: 12 }}>
            跨夜睡眠请把结束日期选为次日；单次睡眠不能超过 24 小时。
          </p>
        </>
      )}
    </Sheet>
  )
}

export function GrowthSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { state, dispatch, toast } = useStore()
  const latest = [...state.growths].sort((a, b) => a.at - b.at).at(-1)
  const [weight, setWeight] = useState('')
  const [height, setHeight] = useState('')
  const [head, setHead] = useState('')

  const save = () => {
    const parse = (raw: string) => {
      const text = raw.trim()
      if (!text) return undefined
      const value = Number(text)
      return Number.isFinite(value) ? value : NaN
    }
    const w = parse(weight)
    const h = parse(height)
    const hd = parse(head)
    if ([w, h, hd].some((value) => value !== undefined && (!Number.isFinite(value) || value <= 0))) {
      toast('成长数据需要填写正数')
      return
    }
    if (w == null && h == null && hd == null) return
    const today = new Date()
    const at = new Date(today.getFullYear(), today.getMonth(), today.getDate(), today.getHours(), today.getMinutes()).getTime()
    if (isBeforeBirth(at, state.baby)) {
      toast('成长记录不能早于宝宝的生日')
      return
    }
    dispatch({
      type: 'addGrowth',
      growth: {
        id: uid('g'),
        at,
        weightKg: w || undefined,
        heightCm: h || undefined,
        headCm: hd || undefined,
      },
    })
    toast('已记录本次成长数据')
    setWeight('')
    setHeight('')
    setHead('')
    onClose()
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="记录身高体重"
      desc={latest ? `上次记录 ${latest.weightKg?.toFixed(1)} kg · ${latest.heightCm} cm` : undefined}
      footer={
        <button className="btn btn--primary btn--full" onClick={save} disabled={!weight && !height && !head}>
          保存成长数据
        </button>
      }
    >
      <div style={{ display: 'grid', gap: 12 }}>
        <label className="field">
          <span className="field__label">体重 · KG</span>
          <input
            className="input"
            inputMode="decimal"
            placeholder="例如 5.6"
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
          />
        </label>
        <label className="field">
          <span className="field__label">身长 · CM</span>
          <input
            className="input"
            inputMode="decimal"
            placeholder="例如 60.5"
            value={height}
            onChange={(e) => setHeight(e.target.value)}
          />
        </label>
        <label className="field">
          <span className="field__label">头围 · CM</span>
          <input
            className="input"
            inputMode="decimal"
            placeholder="例如 39.5"
            value={head}
            onChange={(e) => setHead(e.target.value)}
          />
        </label>
      </div>
      <p className="about-note" style={{ textAlign: 'left', marginTop: 14 }}>
        数据仅作家庭记录，不构成医疗建议。生长曲线请以儿保医生的评估为准。
      </p>
    </Sheet>
  )
}
