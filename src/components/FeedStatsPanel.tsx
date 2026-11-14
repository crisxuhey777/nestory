import { Icon } from '../brand/icons'
import { SectionHead } from './Common'
import { shortSpan, timeHM } from '../lib/date'
import type { FeedStats } from '../lib/stats'

type FeedTrendDay = { day: number; label: string; count: number }

type FeedStatsPanelProps = {
  stats: FeedStats
  week: FeedTrendDay[]
  reminder: { enabled: boolean; intervalMinutes: number }
  onOpenReminders: () => void
}

/**
 * 喂养中心的「今日统计 + 近 7 天趋势 + 提醒入口」整块。
 *
 * 从 Feed.tsx 里拆出的纯展示层：数据全部由页面算好传进来，
 * 这里只负责排版，方便以后单独调样式而不动记录表单。
 */
export function FeedStatsPanel({ stats, week, reminder, onOpenReminders }: FeedStatsPanelProps) {
  const maxWeek = Math.max(1, ...week.map((w) => w.count))
  const weekTotal = week.reduce((sum, w) => sum + w.count, 0)

  return (
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
          <span className="trend__value">共 {weekTotal} 次</span>
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
        onClick={onOpenReminders}
      >
        <Icon name="bell" size={20} />
        <span className="anniversary__text">
          <span className="anniversary__title">
            {reminder.enabled ? `每 ${reminder.intervalMinutes / 60} 小时提醒` : '提醒已关闭'}
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
  )
}
