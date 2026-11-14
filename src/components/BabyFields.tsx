import { toISODate } from '../lib/date'
import type { Baby } from '../data/types'

/** 只放纯展示的档案字段；头像宫格有自己的组件与手势，留在页面里。 */
export type BabyFieldsValue = {
  name: string
  birthday: string
  birthTime: string
  gender: Baby['gender']
  birthWeightKg: string
  birthHeightCm: string
  birthHeadCm: string
  birthplace: string
}

export function BabyFields({
  form,
  now,
  onChange,
}: {
  form: BabyFieldsValue
  now: number
  onChange: (patch: Partial<BabyFieldsValue>) => void
}) {
  return (
    <>
      <label className="field">
        <span className="field__label">昵称</span>
        <input
          className="input"
          value={form.name}
          maxLength={12}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="宝宝的小名"
        />
      </label>
      <div className="field-row">
        <label className="field">
          <span className="field__label">出生日期</span>
          <input
            className="input"
            type="date"
            value={form.birthday}
            max={toISODate(now)}
            onChange={(e) => onChange({ birthday: e.target.value })}
          />
        </label>
        <label className="field">
          <span className="field__label">出生时间</span>
          <input
            className="input"
            type="time"
            value={form.birthTime}
            onChange={(e) => onChange({ birthTime: e.target.value })}
          />
        </label>
      </div>
      <div className="field">
        <span className="field__label">性别</span>
        <div className="segmented">
          {(
            [
              ['girl', '女孩'],
              ['boy', '男孩'],
            ] as const
          ).map(([v, l]) => (
            <button
              key={v}
              type="button"
              className={`segmented__item${form.gender === v ? ' segmented__item--on' : ''}`}
              onClick={() => onChange({ gender: v })}
            >
              {l}
            </button>
          ))}
        </div>
      </div>
      <div className="field-row field-row--three">
        <label className="field">
          <span className="field__label">出生体重 · kg</span>
          <input
            className="input"
            inputMode="decimal"
            value={form.birthWeightKg}
            onChange={(e) => onChange({ birthWeightKg: e.target.value })}
          />
        </label>
        <label className="field">
          <span className="field__label">出生身长 · cm</span>
          <input
            className="input"
            inputMode="decimal"
            value={form.birthHeightCm}
            onChange={(e) => onChange({ birthHeightCm: e.target.value })}
          />
        </label>
        <label className="field">
          <span className="field__label">头围 · cm</span>
          <input
            className="input"
            inputMode="decimal"
            value={form.birthHeadCm}
            onChange={(e) => onChange({ birthHeadCm: e.target.value })}
          />
        </label>
      </div>
      <label className="field">
        <span className="field__label">出生地</span>
        <input
          className="input"
          value={form.birthplace}
          maxLength={20}
          onChange={(e) => onChange({ birthplace: e.target.value })}
          placeholder="例如 杭州"
        />
      </label>
    </>
  )
}
