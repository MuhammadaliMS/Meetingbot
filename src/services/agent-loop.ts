import {
  extractReadySentences,
  stripThinkStreamingChunk,
} from './agent-streaming.js'

export interface AgentMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface AgentResponse {
  text: string
  audioBase64: string
  visemes: string[]
  vtimes: number[]
  vdurations: number[]
}

interface MiniMaxMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

interface ConversationState {
  history: MiniMaxMessage[]
  summary: string
}

export class AgentLoop {
  private static readonly MAX_RECENT_HISTORY_MESSAGES = 8
  private static readonly COMPACT_THRESHOLD_MESSAGES = 12
  private static readonly MAX_SUMMARY_LINES = 10
  private static readonly MAX_SUMMARY_CHARS = 1_200
  private static readonly TEMPERATURE = 0.4
  private static readonly MAX_TOKENS = 160

  private readonly apiKey: string
  private readonly model: string
  private readonly baseUrl: string
  private readonly systemPrompt: string
  private readonly conversationStates = new Map<string, ConversationState>()

  constructor(apiKey: string, model: string = 'MiniMax-M2.7-highspeed', baseUrl: string = 'https://api.minimax.io/v1/chat/completions') {
    this.apiKey = apiKey
    this.model = model
    this.baseUrl = baseUrl
    this.systemPrompt = `You are a helpful AI meeting assistant. You join meetings and participate in conversations naturally.

Rules:
- Be concise and conversational
- Respond naturally to what people say
- Ask clarifying questions when needed
- Don't be overly formal
- Keep responses short (1-3 sentences unless asked for detail)
- You can hear the meeting through live captions`
  }

  async getResponse(
    userMessage: string,
    signal?: AbortSignal,
    conversationId = 'global',
  ): Promise<string> {
    const messages = this.appendUserMessage(conversationId, userMessage)
    const response = await this.createCompletionRequest(messages, signal)

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`MiniMax API error: ${response.status} ${errorText}`)
    }

    const data = await response.json() as { choices: { message: { content: string } }[] }
    const raw = data.choices?.[0]?.message?.content ?? ''
    const assistantText = this.stripThinkBlocks(raw)

    this.appendAssistantMessage(conversationId, assistantText)

    return assistantText
  }

  async streamResponseBySentence(
    userMessage: string,
    onSentence: (sentence: string) => Promise<void> | void,
    signal?: AbortSignal,
    conversationId = 'global',
  ): Promise<string> {
    const messages = this.appendUserMessage(conversationId, userMessage)
    const response = await this.createCompletionRequest(messages, signal, true)

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`MiniMax API error: ${response.status} ${errorText}`)
    }

    const contentType = response.headers.get('content-type') ?? ''
    if (!response.body || !contentType.includes('text/event-stream')) {
      const data = await response.json() as { choices: { message: { content: string } }[] }
      const raw = data.choices?.[0]?.message?.content ?? ''
      const assistantText = this.stripThinkBlocks(raw)
      const ready = extractReadySentences(assistantText)

      for (const sentence of ready.sentences) {
        await onSentence(sentence)
      }
      if (ready.remainder.trim()) {
        await onSentence(ready.remainder.trim())
      }

      this.appendAssistantMessage(conversationId, assistantText)
      return assistantText
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let eventBuffer = ''
    let rawAssistantText = ''
    let visibleText = ''
    let sentenceBuffer = ''
    let stripState = { carry: '', inThinkBlock: false }

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      eventBuffer += decoder.decode(value, { stream: true })
      let boundary = eventBuffer.indexOf('\n\n')

      while (boundary !== -1) {
        const block = eventBuffer.slice(0, boundary)
        eventBuffer = eventBuffer.slice(boundary + 2)

        for (const line of block.split('\n')) {
          const trimmed = line.trim()
          if (!trimmed.startsWith('data:')) continue

          const payloadText = trimmed.slice(5).trim()
          if (!payloadText || payloadText === '[DONE]') {
            continue
          }

          const payload = JSON.parse(payloadText) as {
            choices?: Array<{
              delta?: {
                content?: string | Array<{ text?: string }>
              }
            }>
          }
          const deltaText = this.extractDeltaText(payload)
          if (!deltaText) continue

          rawAssistantText += deltaText

          const stripped = stripThinkStreamingChunk(deltaText, stripState)
          stripState = stripped.state
          if (!stripped.visibleText) continue

          visibleText += stripped.visibleText
          sentenceBuffer += stripped.visibleText

          const ready = extractReadySentences(sentenceBuffer)
          sentenceBuffer = ready.remainder

          for (const sentence of ready.sentences) {
            await onSentence(sentence)
          }
        }

        boundary = eventBuffer.indexOf('\n\n')
      }
    }

    if (!stripState.inThinkBlock && stripState.carry) {
      visibleText += stripState.carry
      sentenceBuffer += stripState.carry
    }

    const tail = sentenceBuffer.trim()
    if (tail) {
      await onSentence(tail)
    }

    const assistantText = visibleText.trim()
    this.appendAssistantMessage(conversationId, assistantText || this.stripThinkBlocks(rawAssistantText))

    return assistantText
  }

  clearHistory(conversationId?: string): void {
    if (conversationId) {
      this.conversationStates.delete(conversationId)
      return
    }

    this.conversationStates.clear()
  }

  private appendUserMessage(conversationId: string, userMessage: string): MiniMaxMessage[] {
    const state = this.getConversationState(conversationId)
    state.history.push({ role: 'user', content: userMessage })
    this.compactConversationState(state)

    return this.buildMessages(state)
  }

  private appendAssistantMessage(conversationId: string, assistantText: string): void {
    const cleaned = assistantText.trim()
    if (!cleaned) {
      return
    }

    const state = this.getConversationState(conversationId)
    state.history.push({ role: 'assistant', content: cleaned })
    this.compactConversationState(state)
  }

  private buildMessages(state: ConversationState): MiniMaxMessage[] {
    const messages: MiniMaxMessage[] = [
      { role: 'system', content: this.systemPrompt },
    ]

    if (state.summary) {
      messages.push({
        role: 'system',
        content: `Conversation memory:\n${state.summary}`,
      })
    }

    messages.push(...state.history.slice(-AgentLoop.MAX_RECENT_HISTORY_MESSAGES))
    return messages
  }

  private createCompletionRequest(
    messages: MiniMaxMessage[],
    signal?: AbortSignal,
    stream = false,
  ): Promise<Response> {
    const finalMessages = messages.map(m => ({
      ...m,
      content: m.content.length > 2000 ? m.content.slice(0, 2000) + '...' : m.content,
    }))

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30_000)
    if (signal) {
      signal.addEventListener('abort', () => controller.abort(), { once: true })
    }

    return fetch(this.baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: this.model,
        messages: finalMessages,
        temperature: AgentLoop.TEMPERATURE,
        max_tokens: AgentLoop.MAX_TOKENS,
        stream,
      }),
    }).finally(() => clearTimeout(timeout))
  }

  private stripThinkBlocks(text: string): string {
    return text.replace(/<think[\s\S]*?<\/think>/g, '').trim()
  }

  private getConversationState(conversationId: string): ConversationState {
    const existing = this.conversationStates.get(conversationId)
    if (existing) {
      return existing
    }

    const created: ConversationState = {
      history: [],
      summary: '',
    }
    this.conversationStates.set(conversationId, created)
    return created
  }

  private compactConversationState(state: ConversationState): void {
    if (state.history.length <= AgentLoop.COMPACT_THRESHOLD_MESSAGES) {
      return
    }

    const compactUntil = state.history.length - AgentLoop.MAX_RECENT_HISTORY_MESSAGES
    if (compactUntil <= 0) {
      return
    }

    const compactedMessages = state.history.slice(0, compactUntil)
    const summaryLines = [
      ...this.extractSummaryLines(state.summary),
      ...compactedMessages
        .map((message) => this.formatSummaryLine(message))
        .filter((line): line is string => Boolean(line)),
    ]

    state.summary = this.limitSummary(summaryLines)
    state.history = state.history.slice(compactUntil)
  }

  private formatSummaryLine(message: MiniMaxMessage): string | null {
    const label = message.role === 'assistant' ? 'Assistant' : 'User'
    const content = message.content
      .replace(/\s+/g, ' ')
      .trim()

    if (!content) {
      return null
    }

    const truncated = content.length > 160
      ? `${content.slice(0, 157).trimEnd()}...`
      : content

    return `${label}: ${truncated}`
  }

  private extractSummaryLines(summary: string): string[] {
    return summary
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
  }

  private limitSummary(lines: string[]): string {
    const deduped = lines.filter((line, index) => lines.indexOf(line) === index)
    const kept = deduped.slice(-AgentLoop.MAX_SUMMARY_LINES)
    let summary = kept.join('\n')

    while (summary.length > AgentLoop.MAX_SUMMARY_CHARS && kept.length > 1) {
      kept.shift()
      summary = kept.join('\n')
    }

    return summary
  }

  private extractDeltaText(payload: {
    choices?: Array<{
      delta?: {
        content?: string | Array<{ text?: string }>
      }
    }>
  }): string {
    const content = payload.choices?.[0]?.delta?.content

    if (typeof content === 'string') {
      return content
    }

    if (Array.isArray(content)) {
      return content
        .map(item => item?.text ?? '')
        .join('')
    }

    return ''
  }
}
