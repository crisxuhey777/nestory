import { useEffect, useState, type RefObject } from 'react'

export type PhotoInk = 'light' | 'dark'

const SAMPLE_SIZE = 32
const BOTTOM_BAND = 0.4
const LIGHT_IMAGE_THRESHOLD = 0.52

/**
 * Rec.709 relative luminance of an sRGB channel value in 0..1.
 */
export function linearize(channel: number) {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
}

/** Turn a 0..1 relative luminance into the treatment used on top of a photo. */
export function toneForLuminance(luminance: number): PhotoInk {
  return luminance >= LIGHT_IMAGE_THRESHOLD ? 'dark' : 'light'
}

/**
 * Whether a photo needs dark type on top of it.
 *
 * We sample the *displayed* cover crop, not the whole source image: the
 * caption sits near the bottom, so only the bottom 40% of the visible box
 * matters. Sampling happens in memory from the already-rendered <img>, so
 * this never triggers another network request.
 *
 * Returns null when the image cannot be sampled reliably (not loaded yet,
 * CORS-tainted canvas, zero-size element).
 */
export async function readPhotoInk(img: HTMLImageElement): Promise<PhotoInk | null> {
  if (!img.complete || !img.naturalWidth || !img.naturalHeight) return null

  const box = img.getBoundingClientRect()
  const boxWidth = box.width || img.clientWidth
  const boxHeight = box.height || img.clientHeight
  if (boxWidth <= 0 || boxHeight <= 0) return null

  const sourceRatio = img.naturalWidth / img.naturalHeight
  const boxRatio = boxWidth / boxHeight
  let sx = 0
  let sy = 0
  let sw = img.naturalWidth
  let sh = img.naturalHeight

  if (sourceRatio > boxRatio) {
    // Image is wider than the box: object-fit cover trims left and right.
    sw = img.naturalHeight * boxRatio
    sx = (img.naturalWidth - sw) / 2
  } else {
    // Image is taller than the box: object-fit cover trims top and bottom.
    sh = img.naturalWidth / boxRatio
    sy = (img.naturalHeight - sh) / 2
  }

  // Only the part under the caption is relevant.
  const bandHeight = sh * BOTTOM_BAND
  sy += sh - bandHeight
  sh = bandHeight

  const canvas = document.createElement('canvas')
  canvas.width = SAMPLE_SIZE
  canvas.height = SAMPLE_SIZE
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null

  try {
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE)
    const data = ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data
    let total = 0
    let count = 0
    for (let i = 0; i < data.length; i += 4) {
      const alpha = data[i + 3] / 255
      if (alpha < 0.15) continue
      total +=
        0.2126 * linearize(data[i] / 255) +
        0.7152 * linearize(data[i + 1] / 255) +
        0.0722 * linearize(data[i + 2] / 255)
      count += 1
    }
    if (!count) return null
    return toneForLuminance(total / count)
  } catch {
    // Tainted canvas, decode failure, etc. Prefer the safe light treatment.
    return null
  }
}

/**
 * Resolve the ink for one image, re-checking when it finishes loading.
 * The caller decides where to put the returned `data-photo-ink`.
 */
export function usePhotoInk(ref: RefObject<HTMLImageElement | null>, sourceKey?: string | number) {
  const [ink, setInk] = useState<PhotoInk | null>(null)

  useEffect(() => {
    const img = ref.current
    setInk(null)
    if (!img) return
    let alive = true

    const resolve = () => {
      void readPhotoInk(img).then((next) => {
        // Keep the previous result on transient failures; null is fine on first run.
        if (alive && next) setInk(next)
      })
    }

    resolve()
    img.addEventListener('load', resolve)
    img.addEventListener('error', resolve)
    return () => {
      alive = false
      img.removeEventListener('load', resolve)
      img.removeEventListener('error', resolve)
    }
  }, [ref, sourceKey])

  return ink
}

/**
 * Precompute ink for a list of photos by id. Home needs this because its
 * slides are mounted together and the active slide's ink must be ready
 * before the next transition, not after.
 */
export function usePhotoInkMap(
  entries: Array<{ id: string; src: string }>,
  enabled = true,
) {
  const [tones, setTones] = useState<Record<string, PhotoInk>>({})

  useEffect(() => {
    if (!enabled || !entries.length) return
    let alive = true
    const host = document.createElement('div')
    host.setAttribute('aria-hidden', 'true')
    host.style.cssText =
      'position:fixed;left:-9999px;top:0;width:96px;height:96px;overflow:hidden;pointer-events:none;visibility:hidden'
    document.body.appendChild(host)

    const images = entries.map((entry) => {
      const img = new Image()
      img.decoding = 'async'
      img.style.cssText = 'display:block;width:96px;height:96px;object-fit:cover'
      img.src = entry.src
      host.appendChild(img)
      return { id: entry.id, img }
    })

    const read = (id: string, img: HTMLImageElement) => {
      void readPhotoInk(img).then((next) => {
        if (!alive || !next) return
        setTones((prev) => (prev[id] === next ? prev : { ...prev, [id]: next }))
      })
    }

    images.forEach(({ id, img }) => {
      if (img.complete) read(id, img)
      else img.addEventListener('load', () => read(id, img), { once: true })
    })

    return () => {
      alive = false
      images.forEach(({ img }) => {
        img.removeAttribute('src')
        img.remove()
      })
      host.remove()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, entries.map((entry) => `${entry.id}:${entry.src}`).join('|')])

  return tones
}
