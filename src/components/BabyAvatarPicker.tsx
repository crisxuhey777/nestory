import type { ChangeEvent, PointerEvent as ReactPointerEvent, RefObject } from 'react'
import { Icon } from '../brand/icons'

export type AvatarChoice = {
  key: string
  src: string
  deletable: boolean
}

type BabyAvatarPickerProps = {
  choices: AvatarChoice[]
  selected: string
  /** 长按中的头像 key，用来给按钮加按住态 */
  holdingKey: string | null
  /** 需要显示删除按钮的头像 key */
  removeKey: string | null
  onSelect: (choice: AvatarChoice) => void
  onHoldStart: (event: ReactPointerEvent, choice: AvatarChoice) => void
  onHoldMove: (event: ReactPointerEvent) => void
  onHoldEnd: () => void
  onRemove: (choice: AvatarChoice) => void
  onPickUpload: () => void
  onPickCamera: () => void
  uploadRef: RefObject<HTMLInputElement | null>
  cameraRef: RefObject<HTMLInputElement | null>
  onFile: (event: ChangeEvent<HTMLInputElement>) => void
}

/**
 * 宝宝资料页的头像选择区：已用头像和默认头像的宫格 + 上传/拍照入口。
 *
 * 长按手势由页面掌握（它还要判断「长按后别触发轻点选择」），
 * 这里只负责铺格子和画按住态。
 */
export function BabyAvatarPicker({
  choices,
  selected,
  holdingKey,
  removeKey,
  onSelect,
  onHoldStart,
  onHoldMove,
  onHoldEnd,
  onRemove,
  onPickUpload,
  onPickCamera,
  uploadRef,
  cameraRef,
  onFile,
}: BabyAvatarPickerProps) {
  return (
    <>
      <div className="avatar-picker">
        {choices.map((choice) => (
          <div className="avatar-picker__slot" key={choice.key}>
            <button
              type="button"
              data-avatar-key={choice.key}
              className={`avatar-picker__item${selected === choice.src ? ' avatar-picker__item--on' : ''}${
                holdingKey === choice.key ? ' avatar-picker__item--holding' : ''
              }`}
              onClick={() => onSelect(choice)}
              onPointerDown={(event) => onHoldStart(event, choice)}
              onPointerMove={onHoldMove}
              onPointerUp={onHoldEnd}
              onPointerCancel={onHoldEnd}
              onPointerLeave={onHoldEnd}
              onContextMenu={(event) => event.preventDefault()}
              aria-label={choice.deletable ? '选择头像，长按显示移除按钮' : '默认头像，不能删除'}
              title={choice.deletable ? '轻点选择 · 长按显示移除' : '默认头像，不能删除'}
            >
              <img src={choice.src} alt="" draggable={false} />
              {choice.deletable ? null : (
                <span className="avatar-picker__lock" aria-hidden="true">
                  <Icon name="shield" size={9} />
                </span>
              )}
            </button>
            {removeKey === choice.key ? (
              <button
                type="button"
                className="avatar-picker__remove"
                aria-label="移除这张头像"
                title="移除这张头像"
                onClick={() => onRemove(choice)}
              >
                <Icon name="close" size={10} />
              </button>
            ) : null}
          </div>
        ))}
      </div>
      <div className="avatar-actions">
        <button type="button" className="btn btn--quiet btn--sm" onClick={onPickUpload}>
          <Icon name="album" size={14} />
          从相册上传
        </button>
        <button type="button" className="btn btn--quiet btn--sm" onClick={onPickCamera}>
          <Icon name="camera" size={14} />
          拍一张
        </button>
      </div>
      <input
        ref={uploadRef}
        className="sr-only"
        type="file"
        accept="image/*"
        aria-label="选择头像图片"
        onChange={onFile}
      />
      <input
        ref={cameraRef}
        className="sr-only"
        type="file"
        accept="image/*"
        capture="environment"
        aria-label="拍摄头像"
        onChange={onFile}
      />
      <p className="timer__hint" style={{ textAlign: 'left', marginTop: 8 }}>
        支持 JPG / PNG，头像会自动裁成方形。长按任意头像显示移除按钮，默认头像会一直保留。
      </p>
    </>
  )
}
