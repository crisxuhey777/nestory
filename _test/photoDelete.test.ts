import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Photo } from '../src/data/types'

const remove = vi.fn()

vi.mock('../src/data/api', () => {
  class ApiError extends Error {
    status: number
    code: string
    constructor(status: number, code: string, message = code) {
      super(message)
      this.status = status
      this.code = code
    }
  }
  return { ApiError, mediaApi: { remove } }
})

const { deletePhotos } = await import('../src/lib/photoDelete')
const { ApiError } = await import('../src/data/api')

function photo(id: string): Photo {
  return {
    id,
    src: `/api/media/blob/${'a'.repeat(32)}`,
    thumb: `/api/media/blob/${'b'.repeat(32)}`,
    at: 0,
    caption: id,
    author: 'me',
    kind: 'photo',
  }
}

describe('deletePhotos', () => {
  beforeEach(() => {
    remove.mockReset()
    remove.mockResolvedValue({ ok: true })
  })

  it('全部成功时，每张照片的原图与缩略图都被删除', async () => {
    const result = await deletePhotos([photo('p1'), photo('p2')])
    expect(remove).toHaveBeenCalledTimes(4)
    expect(result.removed.map((p) => p.id)).toEqual(['p1', 'p2'])
    expect(result.avatarBlocked).toBe(false)
    expect(result.failed).toBe(false)
  })

  it('正在当头像的照片整张跳过，其余照常删除', async () => {
    remove.mockImplementation(async (id: string) => {
      if (id.startsWith('a')) throw new ApiError(409, 'avatar_in_use', '头像占用')
      return { ok: true }
    })
    const result = await deletePhotos([photo('p1')])
    expect(result.avatarBlocked).toBe(true)
    expect(result.removed).toEqual([])
    expect(result.failed).toBe(false)
  })

  it('非 404 的失败只影响这一张，并且标记 failed', async () => {
    let call = 0
    remove.mockImplementation(async () => {
      call += 1
      if (call === 1) throw new ApiError(500, 'server_error', '服务器错误')
      return { ok: true }
    })
    const result = await deletePhotos([photo('p1'), photo('p2')])
    expect(result.failed).toBe(true)
    expect(result.removed.map((p) => p.id)).toEqual(['p2'])
  })

  it('404 视为已经删过，照片仍算删除成功', async () => {
    remove.mockRejectedValue(new ApiError(404, 'not_found', '没找到'))
    const result = await deletePhotos([photo('p1')])
    expect(result.failed).toBe(false)
    expect(result.avatarBlocked).toBe(false)
    expect(result.removed.map((p) => p.id)).toEqual(['p1'])
  })
})
