import { Icon } from '../brand/icons'

/** 相册批量选择时贴在底部的操作条。 */
export function AlbumSelectBar({
  count,
  onCancel,
  onDelete,
}: {
  count: number
  onCancel: () => void
  onDelete: () => void
}) {
  return (
    <div className="album-select-bar">
      <button type="button" className="album-select-bar__cancel" onClick={onCancel}>
        取消
      </button>
      <span className="album-select-bar__count">
        {count ? `已选 ${count} 项` : '选择要删除的照片'}
      </span>
      <button
        type="button"
        className="album-select-bar__delete"
        disabled={!count}
        onClick={onDelete}
      >
        <Icon name="trash" size={15} />
        移入回收站
      </button>
    </div>
  )
}
