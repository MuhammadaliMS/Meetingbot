import { afterEach, describe, expect, it, vi } from 'vitest'

import { AgentLoop } from '../src/services/agent-loop.js'

describe('AgentLoop', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('respects AbortSignal and strips think tags', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect((init?.signal as AbortSignal)?.aborted).toBe(false)

      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '\u003Cthink\u003Ehidden\u003C/think\u003E Hello there.' } }],
        }),
      } satisfies Partial<Response>
    })

    vi.stubGlobal('fetch', fetchMock)

    const signal = new AbortController().signal
    const loop = new AgentLoop('test-key')
    const response = await (loop as any).getResponse('Hi', signal)

    expect(response).toBe('Hello there.')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('keeps conversation history isolated per session', async () => {
    const requests: Array<{ messages: Array<{ role: string; content: string }> }> = []
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body)))

      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Acknowledged.' } }],
        }),
      } satisfies Partial<Response>
    })

    vi.stubGlobal('fetch', fetchMock)

    const loop = new AgentLoop('test-key')
    await loop.getResponse('Speaker A: project alpha update', undefined, 'session-a')
    await loop.getResponse('Speaker B: project beta update', undefined, 'session-b')

    const secondRequest = requests[1]
    expect(secondRequest.messages.some((message) => message.content.includes('project alpha'))).toBe(false)
    expect(secondRequest.messages.some((message) => message.content.includes('project beta'))).toBe(true)
  })

  it('compacts older conversation history into a rolling memory summary', async () => {
    const requests: Array<{ messages: Array<{ role: string; content: string }> }> = []
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body)))

      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Short reply.' } }],
        }),
      } satisfies Partial<Response>
    })

    vi.stubGlobal('fetch', fetchMock)

    const loop = new AgentLoop('test-key')

    for (let index = 1; index <= 9; index += 1) {
      await loop.getResponse(`Speaker ${index}: topic ${index}`, undefined, 'session-a')
    }

    const lastRequest = requests.at(-1)
    const memoryMessage = lastRequest?.messages.find((message) =>
      message.role === 'system' && message.content.includes('Conversation memory:'),
    )

    expect(memoryMessage).toBeTruthy()
    expect(memoryMessage?.content).toContain('Speaker 1: topic 1')
    expect(lastRequest?.messages.filter((message) => message.role === 'user').some((message) => message.content.includes('topic 1'))).toBe(false)
  })
})
