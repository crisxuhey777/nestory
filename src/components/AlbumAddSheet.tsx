import { useRef, useState } from 'react'
import { Icon } from '../brand/icons'
import { Sheet } from './Sheet'
import type { AlbumDraft, PickMode } from './AlbumCards'
import { ApiError } from '../data/api'
import { useStore } from '../data/store'
import { MEDIA_GROUPS, MEDIA_LIMITS } from '../data/config'
import { toISODate, timeHM } from '../lib/date'
import { inspectVideo, uploadClip, uploadPhoto } from '../lib/media'

/**
 * 「添加到相册」浮层：选照片/视频/相机 → 压缩上传 → 抛出一个草稿给页面。
 * 草稿之后的标题、日期时间编辑由页面负责，这里只管把文件变成可保存的记录。
 */
export function AlbumAddSheet({
  open,
  onClose,
  onDraft,
}: {
  open: boolean
  onClose: () => void
  onDraft: (draft: AlbumDraft) => void
}) {
  const { toast } = useStore()
  const [busy, setBusy] = useState(false)
  const photoRef = useRef<HTMLInputElement>(null)
  const photoCamRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<HTMLInputElement>(null)
  const videoCamRef = useRef<HTMLInputElement>(null)

  const mediaRefs = {
    photoLibrary: photoRef,
    photoCamera: photoCamRef,
    videoLibrary: videoRef,
    videoCamera: videoCamRef,
  }

  const onPick = async (file: File | undefined, picked: PickMode, input: HTMLInputElement) => {
    if (!file || busy) return
    const isClip = file.type.startsWith('video/') || /\.(mov|mp4|m4v)$/i.test(file.name)
    const mode: PickMode = picked === 'photo' && isClip ? 'live' : picked
    setBusy(true)
    try {
      const now = Date.now()
      if (mode === 'photo') {
        const { url, thumb } = await uploadPhoto(file)
        onDraft({
          src: url,
          thumb,
          kind: 'photo',
          atDate: toISODate(now),
          atTime: timeHM(now),
          caption: '',
        })
      } else {
        if (file.size > MEDIA_LIMITS.videoMaxMB * 1024 * 1024) {
          toast(`这段视频超过 ${MEDIA_LIMITS.videoMaxMB} MB，换一段短一些的`)
          return
        }
        const info = await inspectVideo(file)
        const { url, poster } = await uploadClip(file, info, mode)
        onDraft({
          src: poster,
          thumb: poster,
          kind: mode === 'live' ? 'photo' : 'video',
          motion: mode === 'live' ? { video: url, durationSec: info.durationSec } : undefined,
          video: mode === 'live' ? undefined : url,
          durationSec: mode === 'live' ? undefined : info.durationSec,
          atDate: toISODate(now),
          atTime: timeHM(now),
          caption: '',
        })
      }
      onClose()
    } catch (error) {
      toast(error instanceof ApiError ? error.message : '这个文件暂时无法读取')
    } finally {
      setBusy(false)
      input.value = ''
    }
  }

  return (
    <>
      <Sheet
        open={open}
        onClose={onClose}
        title="添加到相册"
        desc="照片留在这里，视频单独存放。"
        footer={
          <p className="media-note">
            Live / 会动的照片会作为一张照片保存，查看时循环播放。
          </p>
        }
      >
        <div className="media-add">
          {MEDIA_GROUPS.map((group) => (
            <div className="media-add__group" key={group.key}>
              <span className="media-add__label">{group.label}</span>
              {group.options.map((option) => (
                <button
                  key={option.key}
                  className="media-opt"
                  disabled={busy}
                  onClick={() => mediaRefs[option.trigger].current?.click()}
                >
                  <span
                    className={`media-opt__icon${option.tone === 'live' ? ' media-opt__icon--live' : ''}`}
                  >
                    <Icon name={option.icon} size={19} />
                  </span>
                  <span className="media-opt__text">
                    <b>{option.title}</b>
                    <small>
                      {option.desc}
                      {option.limit ? ` · 最长 ${MEDIA_LIMITS[option.limit]} MB` : ''}
                    </small>
                  </span>
                  <Icon name="chevronRight" size={16} />
                </button>
              ))}
            </div>
          ))}
        </div>
      </Sheet>

      <input
        ref={photoRef}
        type="file"
        accept="image/*,video/*,.mov"
        aria-label="从相册选择照片或视频"
        className="sr-only"
        onChange={(e) => void onPick(e.target.files?.[0], 'photo', e.target)}
      />
      <input
        ref={photoCamRef}
        type="file"
        accept="image/*"
        capture="environment"
        aria-label="拍照"
        className="sr-only"
        onChange={(e) => void onPick(e.target.files?.[0], 'photo', e.target)}
      />
      <input
        ref={videoRef}
        type="file"
        accept="video/*"
        aria-label="从相册选择视频"
        className="sr-only"
        onChange={(e) => void onPick(e.target.files?.[0], 'video', e.target)}
      />
      <input
        ref={videoCamRef}
        type="file"
        accept="video/*"
        capture="environment"
        aria-label="拍视频"
        className="sr-only"
        onChange={(e) => void onPick(e.target.files?.[0], 'video', e.target)}
      />
    </>
  )
}
