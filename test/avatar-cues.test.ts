import { describe, expect, it } from 'vitest'

import {
  buildMouthCueTimeline,
  mouthOpennessFromAmplitude,
} from '../src/avatar/cues.js'

describe('mouthOpennessFromAmplitude', () => {
  it('clamps numeric amplitudes into the expected range', () => {
    expect(mouthOpennessFromAmplitude(-1)).toBe(0)
    expect(mouthOpennessFromAmplitude(0.4)).toBe(0.4)
    expect(mouthOpennessFromAmplitude(2)).toBe(1)
  })

  it('returns zero for invalid numbers', () => {
    expect(mouthOpennessFromAmplitude(Number.NaN)).toBe(0)
    expect(mouthOpennessFromAmplitude(Number.POSITIVE_INFINITY)).toBe(0)
  })
})

describe('buildMouthCueTimeline', () => {
  it('creates deterministic cues from timed visemes', () => {
    const cues = buildMouthCueTimeline([
      { atMs: 0, visemeId: 'silence', durationMs: 60 },
      { atMs: 80, visemeId: 'AA', durationMs: 100 },
      { atMs: 210, visemeId: 'OO', durationMs: 120 },
    ])

    expect(cues).toEqual([
      { startMs: 0, endMs: 60, shape: 'closed' },
      { startMs: 80, endMs: 180, shape: 'wide' },
      { startMs: 210, endMs: 330, shape: 'round' },
    ])
  })

  it('merges adjacent cues with the same shape', () => {
    const cues = buildMouthCueTimeline([
      { atMs: 0, visemeId: 'AA', durationMs: 120 },
      { atMs: 100, visemeId: 'A', durationMs: 120 },
    ])

    expect(cues).toEqual([
      { startMs: 0, endMs: 220, shape: 'wide' },
    ])
  })
})
