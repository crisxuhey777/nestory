import { Icon } from '../brand/icons'
import type { FeedRecord } from '../data/types'
import { shortSpan, timeHM } from '../lib/date'

export type RecordGroup = { label: string; items: FeedRecord[] }

/** 一条喂养记录的展示行：概览与「全部记录」两处共用。 */
function RecordRow({
  record,
  interval,
  onEdit,
  onDelete,
}: {
  record: FeedRecord
  interval?: number
  onEdit: (record: FeedRecord) => void
  onDelete: (record: FeedRecord) => void
}) {
  return (
    <div className="record">
      <span className="record__time">{timeHM(record.startedAt)}</span>
      <div className="record__main">
        <div className="record__title">{recordTitle(record)}</div>
        <div className="record__meta">
          {interval != null ? `距上次 ${shortSpan(interval)}` : '当日首餐'}
          {' · '}
          {record.author}
          {record.note ? ` · ${record.note}` : ''}
        </div>
      </div>
      <div className="record__tools">
        <button aria-label="编辑记录" onClick={() => onEdit(record)}>
          <Icon name="edit" size={14} />
        </button>
        <button aria-label="删除记录" onClick={() => onDelete(record)}>
          <Icon name="trash" size={14} />
        </button>
      </div>
    </div>
  )
}

export function recordTitle(r: FeedRecord): string {
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

/** 按「今天 / 昨天 / 日期」分组的记录列表；compact 用于页面概览，默认用于全量列表。 */
export function RecordGroups({
  groups,
  intervalMap,
  onEdit,
  onDelete,
  compact = false,
}: {
  groups: RecordGroup[]
  intervalMap: Map<string, number>
  onEdit: (record: FeedRecord) => void
  onDelete: (record: FeedRecord) => void
  compact?: boolean
}) {
  return (
    <>
      {groups.map((g) => (
        <div key={g.label} style={{ marginBottom: compact ? 8 : 10 }}>
          <div
            className="divider-label"
            style={{ margin: compact ? '10px 0 4px' : '14px 0 4px' }}
          >
            {g.label}
          </div>
          <div className="records">
            {g.items.map((r) => (
              <RecordRow
                key={r.id}
                record={r}
                interval={intervalMap.get(r.id)}
                onEdit={onEdit}
                onDelete={onDelete}
              />
            ))}
          </div>
        </div>
      ))}
    </>
  )
}
