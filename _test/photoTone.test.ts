import { describe, expect, it } from 'vitest'
import { linearize, toneForLuminance } from '../src/lib/photoTone'

describe('photo tone', () => {
  it('linearizes sRGB channels and keeps the endpoints', () => {
    expect(linearize(0)).toBe(0)
    expect(linearize(1)).toBe(1)
    expect(linearize(0.5)).toBeCloseTo(0.214, 3)
    expect(linearize(0.04)).toBeCloseTo(0.0031, 3)
  })

  it('switches to dark type at the luminance threshold', () => {
    expect(toneForLuminance(0)).toBe('light')
    expect(toneForLuminance(0.519)).toBe('light')
    expect(toneForLuminance(0.52)).toBe('dark')
    expect(toneForLuminance(1)).toBe('dark')
  })
})
