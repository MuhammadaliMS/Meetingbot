import { beforeEach, describe, expect, it, vi } from 'vitest'

const launch = vi.fn()
const launchPersistentContext = vi.fn()

vi.mock('playwright-core', () => ({
  chromium: {
    launch,
    launchPersistentContext,
  },
}))

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs')

  return {
    ...actual,
    existsSync: vi.fn((path: string) => {
      if (path.endsWith('/.openutter/auth.json')) {
        return false
      }
      return actual.existsSync(path)
    }),
  }
})

import { parseConfig } from '../src/config.js'
import { createMeetingSession } from '../src/providers/meeting-provider.js'

describe('createMeetingSession', () => {
  beforeEach(() => {
    launch.mockReset()
    launchPersistentContext.mockReset()
  })

  it('fails fast when auth mode is requested without saved auth state', async () => {
    await expect(createMeetingSession(
      {
        meetingUrl: 'https://meet.google.com/abc-defg-hij',
        joinMode: 'auth',
      },
      parseConfig({}),
      () => {},
    )).rejects.toThrow(/auth\.json/i)

    expect(launch).not.toHaveBeenCalled()
    expect(launchPersistentContext).not.toHaveBeenCalled()
  })
})
