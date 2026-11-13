import type { Photo, PhotoMotion } from '../data/types'

/**
 * A "live" photo is still a photo: one still frame plus a short motion clip.
 * Legacy records stored `kind: 'live'`; new records keep `kind: 'photo'`
 * and put the clip in `motion`.
 */
export function motionOf(photo: Photo): PhotoMotion | undefined {
  if (photo.motion) return photo.motion
  if (photo.kind === 'live') {
    return {
      video: photo.video,
      videoId: photo.videoId,
      durationSec: photo.durationSec,
    }
  }
  return undefined
}

export function hasMotion(photo: Photo): boolean {
  const motion = motionOf(photo)
  return !!motion && !!(motion.video || motion.videoId)
}

export function isVideoPhoto(photo: Photo): boolean {
  return photo.kind === 'video'
}
