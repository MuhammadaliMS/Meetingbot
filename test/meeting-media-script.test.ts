import { describe, expect, it } from 'vitest'

import { MEETING_MEDIA_INJECTION_SCRIPT } from '../src/avatar/meeting-media-script.js'

describe('MEETING_MEDIA_INJECTION_SCRIPT', () => {
  it('injects a synthetic camera feed backed by a canvas avatar', () => {
    expect(MEETING_MEDIA_INJECTION_SCRIPT).toContain('canvas.captureStream(24)')
    expect(MEETING_MEDIA_INJECTION_SCRIPT).toContain('__meetingbot_ensureVideoTrack')
  })

  it('supports synchronized speech injection for audio and visemes', () => {
    expect(MEETING_MEDIA_INJECTION_SCRIPT).toContain('__meetingbot_injectSpeech')
    expect(MEETING_MEDIA_INJECTION_SCRIPT).toContain('scheduleVisemes')
  })
})
