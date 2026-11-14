import { ApiError, mediaApi } from '../data/api'
import type { Photo } from '../data/types'
import { mediaIdsOf } from './media'

/** 一条照片/视频背后可能有多条媒体记录：原图、缩略图、视频、Live 片段都要删掉。 */
export function mediaIdsOfPhoto(photo: Photo): string[] {
  return mediaIdsOf(photo.src, photo.thumb, photo.video, photo.motion?.video)
}

export type DeletePhotosResult = {
  removed: Photo[]
  avatarBlocked: boolean
  failed: boolean
}

/**
 * 逐张删除照片背后的全部媒体记录。
 * - 有记录正在被当作头像：整张跳过（avatar_in_use），交给调用方提示先换头像；
 * - 其他非 404 错误：这一张算失败，继续处理后面的；
 * - 404：当已经删过，视为成功。
 * 不碰 store：删成功的照片由调用方决定怎么放进回收站。
 */
export async function deletePhotos(photos: Photo[]): Promise<DeletePhotosResult> {
  const removed: Photo[] = []
  let avatarBlocked = false
  let failed = false

  for (const photo of photos) {
    let blocked = false
    let photoFailed = false
    for (const mediaId of mediaIdsOfPhoto(photo)) {
      try {
        await mediaApi.remove(mediaId)
      } catch (err) {
        if (err instanceof ApiError && err.code === 'avatar_in_use') {
          blocked = true
          break
        }
        if (!(err instanceof ApiError && err.status === 404)) {
          photoFailed = true
          break
        }
      }
    }
    if (blocked) {
      avatarBlocked = true
      continue
    }
    if (photoFailed) {
      failed = true
      continue
    }
    removed.push(photo)
  }

  return { removed, avatarBlocked, failed }
}
