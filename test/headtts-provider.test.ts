import { afterEach, describe, expect, it, vi } from 'vitest'

import { HeadTTSProvider } from '../src/providers/headtts-provider.js'

describe('HeadTTSProvider', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('respects AbortSignal by aborting the request', async () => {
    const controller = new AbortController()
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect((init?.signal as AbortSignal)?.aborted).toBe(false)
      return {
        ok: true,
        json: async () => ({
          audio: 'ZmFrZQ==',
          visemes: ['sil'],
          vtimes: [0],
          vdurations: [120],
          words: ['hello'],
          wtimes: [0],
          wdurations: [120],
          phonemes: ['HH AH L OW'],
          audioEncoding: 'wav',
        }),
      } satisfies Partial<Response>
    })

    vi.stubGlobal('fetch', fetchMock)

    const provider = new HeadTTSProvider('http://localhost:8882')
    const response = await (provider as any).synthesize({ input: 'hello' }, controller.signal)

    expect(response.visemes).toEqual(['sil'])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
