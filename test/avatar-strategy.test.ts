import { describe, expect, it } from 'vitest'

import { buildAvatarRecommendation } from '../src/services/avatar-strategy.js'

describe('buildAvatarRecommendation', () => {
  it('recommends Pika for the fastest demo when hosted providers are allowed', () => {
    const recommendation = buildAvatarRecommendation(
      {
        meetingPlatform: 'google_meet',
        deploymentGoal: 'demo_fast',
        gpuAvailability: 'none',
        needsPhotorealism: true,
        needsLowLatency: true,
      },
      true,
    )

    expect(recommendation.provider).toBe('pika')
  })

  it('recommends bitHuman and LiveKit for self-hosted photoreal GPU setups', () => {
    const recommendation = buildAvatarRecommendation(
      {
        meetingPlatform: 'google_meet',
        deploymentGoal: 'self_hosted',
        gpuAvailability: 'consumer',
        needsPhotorealism: true,
        needsLowLatency: true,
      },
      false,
    )

    expect(recommendation.provider).toBe('bithuman_livekit')
  })

  it('recommends the open-source neural stack when requested and a GPU exists', () => {
    const recommendation = buildAvatarRecommendation(
      {
        meetingPlatform: 'google_meet',
        deploymentGoal: 'open_source',
        gpuAvailability: 'datacenter',
        needsPhotorealism: true,
        needsLowLatency: true,
      },
      false,
    )

    expect(recommendation.provider).toBe('musetalk_liveportrait')
  })

  it('falls back to a 2D viseme avatar when no GPU is available', () => {
    const recommendation = buildAvatarRecommendation(
      {
        meetingPlatform: 'google_meet',
        deploymentGoal: 'self_hosted',
        gpuAvailability: 'none',
        needsPhotorealism: false,
        needsLowLatency: true,
      },
      false,
    )

    expect(recommendation.provider).toBe('svg_viseme_avatar')
  })
})
