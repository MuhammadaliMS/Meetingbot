import { describe, expect, it } from 'vitest'

import { parseConfig } from '../src/config.js'

describe('parseConfig', () => {
  it('uses documented defaults', () => {
    const config = parseConfig({})

    expect(config.PORT).toBe(3000)
    expect(config.HOST).toBe('0.0.0.0')
    expect(config.OPENUTTER_BIN).toBe('npx')
    expect(config.ALLOW_HOSTED_AVATAR_PROVIDERS).toBe(false)
  })

  it('accepts env overrides', () => {
    const config = parseConfig({
      PORT: '4100',
      HOST: '127.0.0.1',
      OPENUTTER_BIN: 'pnpm',
      OPENUTTER_CWD: '/tmp/meetingbot',
      ALLOW_HOSTED_AVATAR_PROVIDERS: 'true',
    })

    expect(config.PORT).toBe(4100)
    expect(config.HOST).toBe('127.0.0.1')
    expect(config.OPENUTTER_BIN).toBe('pnpm')
    expect(config.OPENUTTER_CWD).toBe('/tmp/meetingbot')
    expect(config.ALLOW_HOSTED_AVATAR_PROVIDERS).toBe(true)
  })

  it('rejects invalid port values', () => {
    expect(() => parseConfig({ PORT: '0' })).toThrow(/Invalid environment configuration/)
  })
})
