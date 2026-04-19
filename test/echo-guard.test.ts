import { describe, expect, it } from 'vitest'

import {
  EchoGuard,
  estimateSpeechDurationMs,
  isLikelySelfEcho,
  normalizeCaptionText,
} from '../src/services/echo-guard.js'

describe('normalizeCaptionText', () => {
  it('normalizes punctuation and whitespace for caption matching', () => {
    expect(normalizeCaptionText(' Hello,   team!! ')).toBe('hello team')
  })
})

describe('estimateSpeechDurationMs', () => {
  it('uses viseme timing when available', () => {
    expect(estimateSpeechDurationMs('hello there', {
      vtimes: [0, 120, 280],
      vdurations: [90, 120, 140],
    })).toBeGreaterThanOrEqual(420)
  })

  it('falls back to text length when viseme timing is sparse', () => {
    expect(estimateSpeechDurationMs('short', {
      vtimes: [],
      vdurations: [],
    })).toBeGreaterThanOrEqual(1200)
  })
})

describe('isLikelySelfEcho', () => {
  it('matches incremental prefixes while the bot is still speaking', () => {
    expect(isLikelySelfEcho(
      'hello everyone',
      'hello everyone i am ready to help',
      true,
    )).toBe(true)
  })

  it('does not classify unrelated interruptions as self echo', () => {
    expect(isLikelySelfEcho(
      'wait stop there',
      'hello everyone i am ready to help',
      true,
    )).toBe(false)
  })
})

describe('EchoGuard', () => {
  it('ignores captions that mirror the bot recent speech', () => {
    const guard = new EchoGuard()
    const now = 1_000

    guard.noteBotSpeech('session-1', 'Hello everyone, I am ready to help.', {
      vtimes: [0, 150, 320],
      vdurations: [100, 130, 140],
    }, now)

    expect(guard.shouldIgnoreCaption('session-1', 'Hello everyone', now + 250)).toBe(true)
    expect(guard.shouldIgnoreCaption('session-1', 'Hello everyone I am ready to help', now + 1_500)).toBe(true)
    expect(guard.shouldIgnoreCaption('session-1', 'Can you stop and listen?', now + 250)).toBe(false)
  })

  it('forgets stale speech so future users are not filtered', () => {
    const guard = new EchoGuard()
    const now = 10_000

    guard.noteBotSpeech('session-2', 'I can summarize that for you.', {
      vtimes: [0, 120],
      vdurations: [120, 150],
    }, now)

    expect(guard.shouldIgnoreCaption('session-2', 'I can summarize that for you', now + 500)).toBe(true)
    expect(guard.shouldIgnoreCaption('session-2', 'I can summarize that for you', now + 20_000)).toBe(false)
  })
})
