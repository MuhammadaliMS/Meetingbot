export interface HeadTTSSynthesizeRequest {
  input: string
  voice?: string
  speed?: number | undefined
  audioEncoding?: 'wav' | 'raw'
}

export interface HeadTTSSynthesizeResponse {
  audio: string
  visemes: string[]
  vtimes: number[]
  vdurations: number[]
  words: string[]
  wtimes: number[]
  wdurations: number[]
  phonemes: string[]
  audioEncoding: string
}

export class HeadTTSProvider {
  private readonly baseUrl: string

  constructor(baseUrl: string = 'http://localhost:8882') {
    this.baseUrl = baseUrl
  }

  async synthesize(
    request: HeadTTSSynthesizeRequest,
    signal?: AbortSignal,
  ): Promise<HeadTTSSynthesizeResponse> {
    const input = request.input.trim()
    if (!input) {
      throw new Error('HeadTTS: empty input')
    }

    const maxChars = 500
    const truncated = input.length > maxChars
      ? input.slice(0, maxChars).replace(/\s+\S*$/, '')
      : input

    const timeoutMs = 30_000
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)

    if (signal) {
      signal.addEventListener('abort', () => controller.abort(), { once: true })
    }

    try {
      const response = await fetch(`${this.baseUrl}/v1/synthesize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          input: truncated,
          voice: request.voice ?? 'af_bella',
          speed: request.speed ?? 1,
          audioEncoding: request.audioEncoding ?? 'wav',
        }),
      })

      if (!response.ok) {
        throw new Error(`HeadTTS error: ${response.status} ${await response.text()}`)
      }

      return (await response.json()) as HeadTTSSynthesizeResponse
    } finally {
      clearTimeout(timeout)
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/v1/synthesize`, {
        method: 'OPTIONS',
      })
      return response.ok || response.status === 405
    } catch {
      return false
    }
  }
}
