import { useState } from 'react'
import { Icon, type IconName } from '../brand/icons'
import { TabHead, Sparkline } from '../components/Common'
import { GrowthAiCard } from '../components/AiPanels'
import { DiaperSheet, GrowthSheet, SleepSheet } from '../components/QuickSheets'
import { useStore } from '../data/store'
import { DAY, ageBetween, ageLabel, fromISODate, isSameDay, shortDate, timeHM } from '../lib/date'
import {
  diaperCountsSince,
  latestGrowth,
  previousGrowth,
  signed,
  sleepStatsSince,
} from '../lib/stats'

type Tab = 'growth' | 'sleep' | 'diaper'
type DiaperFilter = 'all' | 'wet' | 'dirty' | 'both'

const TABS: { key: Tab; label: string }[] = [
  { key: 'growth', label: '生长' },
  { key: 'sleep', label: '睡眠' },
  { key: 'diaper', label: '尿布' },
]

const DIAPER_FILTERS: { key: DiaperFilter; label: string; icon: IconName }[] = [
  { key: 'all', label: '全部', icon: 'all' },
  { key: 'wet', label: '小便', icon: 'drop' },
  { key: 'dirty', label: '大便', icon: 'diaper' },
  { key: 'both', label: '混合', icon: 'both' },
]

export default function GrowthPage() {
  const { state } = useStore()
  const [tab, setTab] = useState<Tab>('growth')
  const [range, setRange] = useState<30 | 90 | 0>(90)
  const [addOpen, setAddOpen] = useState(false)
  const [diaperFilter, setDiaperFilter] = useState<DiaperFilter>('all')
  const now = Date.now()

  const latest = latestGrowth(state.growths)
  const prev = previousGrowth(state.growths)
  const weekStart = now - 7 * DAY
  const sleepWeek = sleepStatsSince(state.sleeps, weekStart, now)
  const diapers = diaperCountsSince(state.diapers, weekStart)
  const ongoing = state.sleeps.find((s) => !s.endedAt)

  const sortedGrowth = [...state.growths].sort((a, b) => a.at - b.at)
  const cutoff = range === 0 ? 0 : now - range * DAY
  const ranged = sortedGrowth.filter((g) => g.at >= cutoff && g.weightKg != null)
  const weightPoints = ranged.map((g) => ({ x: g.at, y: g.weightKg as number }))

  const weightDelta =
    latest?.weightKg != null && prev?.weightKg != null ? latest.weightKg - prev.weightKg : null

  const todaySleeps = [...state.sleeps]
    .filter((s) => s.startedAt >= weekStart)
    .sort((a, b) => b.startedAt - a.startedAt)

  const todayDiapers = [...state.diapers]
    .filter((d) => d.at >= weekStart)
    .sort((a, b) => b.at - a.at)

  const diaperFilterCounts: Record<DiaperFilter, number> = {
    all: todayDiapers.length,
    wet: todayDiapers.filter((d) => d.kind === 'wet').length,
    dirty: todayDiapers.filter((d) => d.kind === 'dirty').length,
    both: todayDiapers.filter((d) => d.kind === 'both').length,
  }
  const filteredDiapers =
    diaperFilter === 'all'
      ? todayDiapers
      : todayDiapers.filter((d) => d.kind === diaperFilter)

  const hasBirth = /^\d{4}-\d{2}-\d{2}$/.test(state.baby.birthday)
  const ageText = hasBirth
    ? ageLabel(ageBetween(new Date(fromISODate(state.baby.birthday)), new Date(now)))
    : '还没有填写生日'
  const headMeta =
    tab === 'growth'
      ? `${ageText} · ${latest ? `最近测量 ${shortDate(latest.at)}` : '还没有测量记录'}`
      : tab === 'sleep'
        ? `${ageText} · 近 7 天睡眠 ${Math.floor(sleepWeek.minutes / 60)} 小时 ${Math.round(sleepWeek.minutes % 60)} 分`
        : `${ageText} · 近 7 天更换 ${diapers.total} 次`

  return (
    <div className="page">
      <TabHead
        en="GROWTH JOURNAL"
        title="成长记录"
        meta={headMeta}
        right={
          <button className="icon-btn" aria-label="新增记录" onClick={() => setAddOpen(true)}>
            <Icon name="plus" size={19} />
          </button>
        }
      />

      <div className="page__body">
        <div className="segmented" role="tablist" style={{ marginTop: 14 }}>
          {TABS.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              className={`segmented__item${tab === t.key ? ' segmented__item--on' : ''}`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <GrowthAiCard />

        {tab === 'growth' ? (
          <>
            <section className="measure">
              <div className="measure__top">
                <span className="measure__eyebrow">LATEST MEASUREMENT</span>
                <span className="measure__date">{latest ? shortDate(latest.at) : '—'}</span>
              </div>

              <div className="measure__weight">
                <span className="measure__num">{latest?.weightKg?.toFixed(1) ?? '—'}</span>
                <span className="measure__unit">kg</span>
                {weightDelta != null ? (
                  <span className="measure__delta">{signed(weightDelta)} kg</span>
                ) : (
                  <span className="measure__delta measure__delta--quiet">首次记录</span>
                )}
              </div>

              <div className="measure__pair">
                <div className="measure__item">
                  <span className="measure__label">身长</span>
                  <b>
                    {latest?.heightCm?.toFixed(1) ?? '—'}
                    <small>cm</small>
                  </b>
                  <i>出生 {state.baby.birthHeightCm?.toFixed(1) ?? '—'} cm</i>
                </div>
                <span className="measure__rule" />
                <div className="measure__item">
                  <span className="measure__label">头围</span>
                  <b>
                    {latest?.headCm?.toFixed(1) ?? '—'}
                    <small>cm</small>
                  </b>
                  <i>出生 {state.baby.birthHeadCm?.toFixed(1) ?? '—'} cm</i>
                </div>
              </div>
            </section>

            <div className="trend">
              <div className="trend__head">
                <span className="trend__title">体重趋势</span>
                <span className="trend__value">
                  {latest?.weightKg != null ? `${latest.weightKg.toFixed(1)} kg` : '还没有数据'}
                </span>
              </div>
              {weightPoints.length > 1 ? (
                <Sparkline points={weightPoints} label="体重趋势" />
              ) : (
                <div className="empty">记录两次以上即可看到曲线</div>
              )}
              <div className="range-tabs">
                {[
                  { v: 30, l: '近 1 月' },
                  { v: 90, l: '近 3 月' },
                  { v: 0, l: '全部' },
                ].map((r) => (
                  <button
                    key={r.v}
                    className={range === r.v ? 'on' : ''}
                    onClick={() => setRange(r.v as 30 | 90 | 0)}
                  >
                    {r.l}
                  </button>
                ))}
              </div>
            </div>

            <div className="growth-list">
              <div className="divider-label" style={{ marginTop: 24 }}>
                测量记录
              </div>
              <div className="growth-row growth-row--head">
                <span>日期</span>
                <span>体重</span>
                <span>身长</span>
                <span>头围</span>
                <span>较上次</span>
              </div>
              {[...sortedGrowth]
                .sort((a, b) => b.at - a.at)
                .map((g, idx, arr) => {
                  const before = arr[idx + 1]
                  const dw = before?.weightKg != null && g.weightKg != null ? g.weightKg - before.weightKg : null
                  return (
                    <div key={g.id} className="growth-row">
                      <span className="growth-row__date">{shortDate(g.at)}</span>
                      <span className="growth-row__num">
                        {g.weightKg?.toFixed(1) ?? '—'}
                        <small>kg</small>
                      </span>
                      <span className="growth-row__num">
                        {g.heightCm?.toFixed(1) ?? '—'}
                        <small>cm</small>
                      </span>
                      <span className="growth-row__num">
                        {g.headCm?.toFixed(1) ?? '—'}
                        <small>cm</small>
                      </span>
                      <span className="growth-row__delta">{dw != null ? signed(dw) : ''}</span>
                    </div>
                  )
                })}
            </div>
            <p className="about-note">成长数据仅作家庭记录，生长评估请以儿保医生的判断为准。</p>
          </>
        ) : null}

        {tab === 'sleep' ? (
          <>
            <div className="metrics">
              <div className="metric" style={{ gridColumn: 'span 2' }}>
                <div className="metric__label">近 7 天睡眠</div>
                <div className="metric__value">
                  {Math.floor(sleepWeek.minutes / 60)}
                  <small>小时</small>
                  {Math.round(sleepWeek.minutes % 60)}
                  <small>分</small>
                </div>
                <div className="metric__delta">{ongoing ? `正在睡 · 从 ${timeHM(ongoing.startedAt)} 开始` : '按实际睡眠时间累计'}</div>
              </div>
              <div className="metric metric--accent">
                <div className="metric__label">睡眠次数</div>
                <div className="metric__value">
                  {sleepWeek.count}
                  <small>次</small>
                </div>
                <div className="metric__delta">近 7 天</div>
              </div>
            </div>

            <div className="growth-list">
              <div className="divider-label" style={{ marginTop: 22 }}>
                最近睡眠
              </div>
              {todaySleeps.map((s) => {
                const end = s.endedAt ?? now
                const min = (end - s.startedAt) / 60000
                return (
                  <div key={s.id} className="record">
                    <span className="record__time">{timeHM(s.startedAt)}</span>
                    <div className="record__main">
                      <div className="record__title">{s.endedAt ? '睡眠' : '睡眠中'}</div>
                      <div className="record__meta">
                        至 {s.endedAt ? timeHM(s.endedAt) : '现在'} · {shortDate(s.startedAt)}
                      </div>
                    </div>
                    <span className="record__amount">
                      {Math.floor(min / 60) > 0 ? `${Math.floor(min / 60)}h${Math.round(min % 60)}m` : `${Math.round(min)}m`}
                    </span>
                  </div>
                )
              })}
              {todaySleeps.length === 0 ? (
                <div className="empty">
                  近 7 天还没有睡眠记录
                  <span className="empty__hint">点右上角 + 记录第一次</span>
                </div>
              ) : null}
            </div>
          </>
        ) : null}

        {tab === 'diaper' ? (
          <>
            <div className="metrics">
              <div className="metric">
                <div className="metric__label">近 7 天小便</div>
                <div className="metric__value">
                  {diapers.wet}
                  <small>次</small>
                </div>
                <div className="metric__delta">共 {diapers.total} 次更换</div>
              </div>
              <div className="metric">
                <div className="metric__label">近 7 天大便</div>
                <div className="metric__value">
                  {diapers.dirty}
                  <small>次</small>
                </div>
                <div className="metric__delta">{diapers.lastAt ? `最近 ${timeHM(diapers.lastAt)}` : '近 7 天还没有'}</div>
              </div>
              <div className="metric metric--accent">
                <div className="metric__label">最近更换</div>
                <div className="metric__value" style={{ fontSize: 'calc(20px * var(--type-scale, 1))' }}>
                  {diapers.lastAt ? timeHM(diapers.lastAt) : '—'}
                </div>
                <div className="metric__delta">
                  {diapers.lastAt ? (isSameDay(diapers.lastAt, now) ? '今天 · 按时间倒序' : `${shortDate(diapers.lastAt)} · 按时间倒序`) : '按时间倒序'}
                </div>
              </div>
            </div>

            <div className="diaper-filter" role="group" aria-label="筛选尿布记录">
              {DIAPER_FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  className="diaper-filter__item"
                  aria-pressed={diaperFilter === f.key}
                  onClick={() => setDiaperFilter(f.key)}
                >
                  <Icon name={f.icon} size={16} />
                  <span>{f.label}</span>
                  <b>{diaperFilterCounts[f.key]}</b>
                </button>
              ))}
            </div>

            <div className="growth-list">
              <div className="divider-label" style={{ marginTop: 22 }}>
                最近记录
              </div>
              {filteredDiapers.map((d) => (
                <div key={d.id} className="record">
                  <span className="record__time">{timeHM(d.at)}</span>
                  <div className="record__main">
                    <div className="record__title">
                      {d.kind === 'wet' ? '小便' : d.kind === 'dirty' ? '大便' : '小便 + 大便'}
                    </div>
                    <div className="record__meta">{shortDate(d.at)} · {d.note ?? '常规更换'}</div>
                  </div>
                  <Icon name={d.kind === 'wet' ? 'drop' : d.kind === 'dirty' ? 'diaper' : 'both'} size={17} />
                </div>
              ))}
              {filteredDiapers.length === 0 ? (
                <div className="empty">
                  {todayDiapers.length === 0 ? '近 7 天还没有尿布记录' : '没有符合筛选的尿布记录'}
                  {todayDiapers.length === 0 ? (
                    <span className="empty__hint">点右上角 + 记录第一次</span>
                  ) : (
                    <button className="empty__action" onClick={() => setDiaperFilter('all')}>
                      查看全部
                    </button>
                  )}
                </div>
              ) : null}
            </div>
            <p className="about-note">若出现颜色异常、血丝或伴随发热，请及时咨询儿科医生。</p>
          </>
        ) : null}
      </div>

      {tab === 'growth' ? <GrowthSheet open={addOpen} onClose={() => setAddOpen(false)} /> : null}
      {tab === 'sleep' ? <SleepSheet open={addOpen} onClose={() => setAddOpen(false)} /> : null}
      {tab === 'diaper' ? <DiaperSheet open={addOpen} onClose={() => setAddOpen(false)} /> : null}
    </div>
  )
}
