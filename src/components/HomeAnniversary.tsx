import { useRef, useState } from 'react'
import { Icon } from '../brand/icons'
import { Sheet } from './Sheet'
import { useStore, uid } from '../data/store'
import { uploadPhoto } from '../lib/media'
import { viewerName } from '../lib/viewer'

/**
 * 纪念日当天「记一张照片 + 一句话」的浮层。
 * 草稿（一句话/照片/上传中）都归组件自己管，保存成功后由页面负责关闭 open。
 */
export function HomeAnniversary({
  open,
  onClose,
  label,
  birthday,
}: {
  open: boolean
  onClose: () => void
  label?: string
  birthday: string
}) {
  const { state, dispatch, toast } = useStore()
  const [note, setNote] = useState('')
  const [photo, setPhoto] = useState<{ file: File; url: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  const close = () => {
    setNote('')
    setBusy(false)
    setPhoto((current) => {
      if (current) URL.revokeObjectURL(current.url)
      return null
    })
    onClose()
  }

  const pick = (file: File | undefined, target: HTMLInputElement) => {
    target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) {
      toast('先选一张照片')
      return
    }
    setPhoto((current) => {
      if (current) URL.revokeObjectURL(current.url)
      return { file, url: URL.createObjectURL(file) }
    })
  }

  const save = async () => {
    if (!label || busy) return
    const text = note.trim()
    if (!text && !photo) {
      toast('写一句话，或选一张照片')
      return
    }
    setBusy(true)
    try {
      const at = Date.now()
      if (photo) {
        const { url, thumb } = await uploadPhoto(photo.file)
        dispatch({
          type: 'addPhoto',
          photo: {
            id: uid('ph'),
            src: url,
            thumb,
            at,
            caption: text || label,
            author: viewerName(state),
            kind: 'photo',
          },
        })
      }
      dispatch({
        type: 'addMilestone',
        milestone: {
          id: uid('ms'),
          at,
          title: label,
          note: text || undefined,
          kind: 'anniversary',
          birthday: birthday || undefined,
        },
      })
      toast(`已记下${label}`)
      close()
    } catch (error) {
      toast(error instanceof Error ? error.message : '保存失败，再试一次')
      setBusy(false)
    }
  }

  return (
    <Sheet
      open={open}
      onClose={close}
      title={label ?? '纪念日'}
      desc={
        label
          ? `今天是${state.baby.name ? `${state.baby.name}的` : ''}${label}。留下一张照片和一句话，会出现在成长时间轴。`
          : ''
      }
      footer={
        <div className="anniversary-foot">
          <button className="btn btn--quiet" onClick={close} type="button">
            先不记
          </button>
          <button className="btn btn--primary" onClick={save} disabled={busy} type="button">
            {busy ? '保存中…' : '记下来'}
          </button>
        </div>
      }
    >
      <div className="anniversary-form">
        <label className="field">
          <span className="field__label">今天的一句话</span>
          <textarea
            className="input"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="比如：第一次抬头看我们。"
            rows={3}
            maxLength={200}
          />
        </label>
        <button type="button" className="anniversary-photo" onClick={() => input.current?.click()}>
          {photo ? (
            <img src={photo.url} alt="" />
          ) : (
            <>
              <Icon name="camera" size={18} />
              <span>选一张今天的照片（可跳过）</span>
            </>
          )}
        </button>
        <input
          ref={input}
          type="file"
          accept="image/*"
          hidden
          onChange={(event) => pick(event.target.files?.[0], event.currentTarget)}
          aria-label="选择纪念日照片"
        />
      </div>
    </Sheet>
  )
}
