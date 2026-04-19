import { describe, expect, it } from 'vitest'

import {
  extractReadySentences,
  getCaptionDebounceMs,
  stripThinkStreamingChunk,
} from '../src/services/agent-streaming.js'

describe('stripThinkStreamingChunk', () => {
  it('removes think blocks even when tags span multiple chunks', () => {
    const first = stripThinkStreamingChunk('<thi', {
      carry: '',
      inThinkBlock: false,
    })
    expect(first.visibleText).toBe('')

    const second = stripThinkStreamingChunk('nk>hidden</th', first.state)
    expect(second.visibleText).toBe('')

    const third = stripThinkStreamingChunk('ink>Hello there.', second.state)
    expect(third.visibleText).toBe('Hello there.')
  })
})

describe('extractReadySentences', () => {
  it('returns only complete sentences and leaves the partial tail buffered', () => {
    const result = extractReadySentences('First sentence. Second one? Partial')

    expect(result.sentences).toEqual(['First sentence.', 'Second one?'])
    expect(result.remainder).toBe('Partial')
  })
})

describe('getCaptionDebounceMs', () => {
  it('responds faster when the caption already ends as a full sentence', () => {
    expect(getCaptionDebounceMs('Can you hear me?')).toBe(450)
    expect(getCaptionDebounceMs('still talking about the agenda')).toBe(800)
  })
})
