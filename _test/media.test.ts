import { describe, expect, it } from 'vitest'
import { mediaIdsOf } from '../src/lib/media'

const one = '/api/media/blob/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const two = '/api/media/blob/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

describe('媒体地址取 id', () => {
  it('一张照片的多份副本都被收集（原图 + 缩略图 + 视频）', () => {
    expect(mediaIdsOf(one, two, null, undefined, '')).toEqual([
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    ])
  })

  it('同一 id 重复出现只留一份', () => {
    expect(mediaIdsOf(one, one, `${one}?w=480`)).toEqual(['aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'])
  })

  it('空值与源文件地址不产生 id', () => {
    expect(mediaIdsOf('data:image/jpeg;base64,xxx', 'https://cdn.example.com/a.jpg')).toEqual([])
    expect(mediaIdsOf()).toEqual([])
  })

  it('连续调用互不影响（正则 lastIndex 复位）', () => {
    expect(mediaIdsOf(`${one} ${two}`)).toHaveLength(2)
    expect(mediaIdsOf(one)).toEqual(['aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'])
    expect(mediaIdsOf(`${one} ${two}`)).toHaveLength(2)
  })
})
