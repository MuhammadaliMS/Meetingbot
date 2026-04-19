import { resolve } from 'node:path'
import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'

import type { AppConfig } from './config.js'
import { registerRoutes } from './routes/register-routes.js'
import { SessionManager } from './services/session-manager.js'
import { HeadTTSProvider } from './providers/headtts-provider.js'
import { AgentLoop } from './services/agent-loop.js'
import { AvatarBridge } from './services/avatar-bridge.js'
import type { AvatarSpeechEvent, ManagedSession } from './domain/types.js'
import type { CaptionEvent } from './providers/openutter-provider.js'
import { EchoGuard } from './services/echo-guard.js'

const SILENCE_TIMEOUT_MS = 15_000
const PENDING_FLUSH_MS = 40
const AGENT_WATCHDOG_MS = 12_000
const BARGE_IN_MIN_CHARS = 6

const pendingCaptionBuffers = new Map<string, {
  timer: ReturnType<typeof setTimeout>
  fragments: Array<{ speaker: string; text: string }>
}>()

const activeAgentControllers = new Map<string, AbortController>()
const agentWatchdogs = new Map<string, ReturnType<typeof setTimeout>>()
const silenceTimers = new Map<string, ReturnType<typeof setTimeout>>()
const echoGuard = new EchoGuard()

export function createApp(
  appConfig: AppConfig,
  headTTS: HeadTTSProvider,
  agentLoop: AgentLoop | null,
) {
  let avatarBridge: AvatarBridge | null = null
  let sessionManager: SessionManager

  function getAgentLoopForSession(): AgentLoop | null {
    return agentLoop
  }

  function getAvatarBridge(): AvatarBridge | null {
    return avatarBridge
  }

  function getSessionManager(): SessionManager | null {
    return sessionManager
  }

  function getHeadTTS(): HeadTTSProvider | null {
    return headTTS
  }

  function resetSilenceTimer(sessionId: string): void {
    const existing = silenceTimers.get(sessionId)
    if (existing) clearTimeout(existing)

    silenceTimers.set(sessionId, setTimeout(() => {
      silenceTimers.delete(sessionId)
      triggerSilenceResponse(sessionId)
    }, SILENCE_TIMEOUT_MS))
  }

  function clearSilenceTimer(sessionId: string): void {
    const existing = silenceTimers.get(sessionId)
    if (existing) {
      clearTimeout(existing)
      silenceTimers.delete(sessionId)
    }
  }

  function clearPendingCaption(sessionId: string): void {
    const pending = pendingCaptionBuffers.get(sessionId)
    if (pending) {
      clearTimeout(pending.timer)
      pendingCaptionBuffers.delete(sessionId)
    }
  }

  function triggerSilenceResponse(sessionId: string): void {
    if (activeAgentControllers.has(sessionId)) return
    if (pendingCaptionBuffers.has(sessionId)) return

    const loop = getAgentLoopForSession()
    if (!loop) return

    const bridge = getAvatarBridge()
    const manager = getSessionManager()
    const tts = getHeadTTS()
    if (!bridge || !manager || !tts) return

    void executeAgentResponse(
      sessionId,
      '[System: There has been silence in the meeting for a while. Say something relevant, ask a question, or share a thought to keep the conversation going. Be natural and brief.]',
      loop,
      tts,
      bridge,
      manager,
    )
  }

  async function interruptAgentResponse(
    sessionId: string,
  ): Promise<void> {
    const controller = activeAgentControllers.get(sessionId)
    if (controller) {
      controller.abort()
    }

    avatarBridge?.broadcastAvatarStop({ sessionId })

    const runtime = sessionManager.getMeetingRuntime(sessionId)
    if (runtime) {
      await runtime.stopAudio().catch((err: Error) => {
        console.error('Meeting audio stop failed:', err.message)
      })
    }
  }

  function handleCaptionWithAgent(
    sessionId: string,
    caption: CaptionEvent,
  ) {
    const loop = getAgentLoopForSession()
    const bridge = getAvatarBridge()
    const tts = getHeadTTS()
    if (!loop || !bridge || !tts) return

    let pending = pendingCaptionBuffers.get(sessionId)
    if (!pending) {
      pending = { timer: setTimeout(() => {}, 0), fragments: [] }
      pendingCaptionBuffers.set(sessionId, pending)
    }

    pending.fragments.push({ speaker: caption.speaker, text: caption.text })
    clearTimeout(pending.timer)

    if (activeAgentControllers.has(sessionId)) {
      if (caption.text.trim().length >= BARGE_IN_MIN_CHARS) {
        void interruptAgentResponse(sessionId)
      } else {
        return
      }
    }

    pending.timer = setTimeout(async () => {
      const buffered = pendingCaptionBuffers.get(sessionId)
      if (!buffered || buffered.fragments.length === 0) return
      if (activeAgentControllers.has(sessionId)) return
      pendingCaptionBuffers.delete(sessionId)

      const prompt = renderPendingPrompt(buffered.fragments)
      await executeAgentResponse(sessionId, prompt, loop, tts, bridge, sessionManager)
    }, PENDING_FLUSH_MS)
  }

  async function executeAgentResponse(
    sessionId: string,
    prompt: string,
    loop: AgentLoop,
    tts: HeadTTSProvider,
    bridge: AvatarBridge,
    manager: SessionManager,
  ) {
    const controller = new AbortController()
    const { signal } = controller
    activeAgentControllers.set(sessionId, controller)

    const existingWatchdog = agentWatchdogs.get(sessionId)
    if (existingWatchdog) clearTimeout(existingWatchdog)
    agentWatchdogs.set(sessionId, setTimeout(() => {
      agentWatchdogs.delete(sessionId)
      if (activeAgentControllers.get(sessionId) === controller) {
        console.error(`[agent] Watchdog aborted stuck response after ${AGENT_WATCHDOG_MS}ms for ${sessionId}`)
        controller.abort()
      }
    }, AGENT_WATCHDOG_MS))

    let playbackChain: Promise<void> = Promise.resolve()

    try {
      await loop.streamResponseBySentence(prompt, (sentence) => {
        if (signal.aborted) return

        const trimmed = sentence.trim()
        if (!trimmed) return

        const ttsPromise = tts.synthesize({ input: trimmed }, signal).catch((ttsErr) => {
          const msg = ttsErr instanceof Error ? ttsErr.message : String(ttsErr)
          if (!isAbortError(ttsErr)) {
            console.error(`[agent] TTS failed for "${trimmed.substring(0, 50)}...": ${msg}`)
          }
          return null
        })

        playbackChain = playbackChain.then(async () => {
          if (signal.aborted) return

          const ttsResult = await ttsPromise
          if (!ttsResult || signal.aborted) return

          const avatarEvent: AvatarSpeechEvent = {
            sessionId,
            audioBase64: ttsResult.audio,
            visemes: ttsResult.visemes,
            vtimes: ttsResult.vtimes,
            vdurations: ttsResult.vdurations,
            text: trimmed,
          }
          echoGuard.noteBotSpeech(sessionId, trimmed, {
            vtimes: ttsResult.vtimes,
            vdurations: ttsResult.vdurations,
          })
          bridge.broadcastAvatarEvent(avatarEvent)

          const runtime = manager.getMeetingRuntime(sessionId)
          if (runtime) {
            await runtime.injectSpeech({
              audioBase64: ttsResult.audio,
              visemes: ttsResult.visemes,
              vtimes: ttsResult.vtimes,
              vdurations: ttsResult.vdurations,
              text: trimmed,
            }).catch((err: Error) => {
              console.error('Meeting speech injection failed:', err.message)
            })
          }
        }).catch((err) => {
          if (!isAbortError(err)) {
            console.error('Playback chain error:', err)
          }
        })
      }, signal, sessionId)

      await playbackChain
    } catch (error) {
      if (!isAbortError(error)) {
        console.error('Agent response failed:', error)
      }
    } finally {
      if (activeAgentControllers.get(sessionId) === controller) {
        activeAgentControllers.delete(sessionId)
      }

      const watchdog = agentWatchdogs.get(sessionId)
      if (watchdog) {
        clearTimeout(watchdog)
        agentWatchdogs.delete(sessionId)
      }

      const buffered = pendingCaptionBuffers.get(sessionId)
      if (buffered && buffered.fragments.length > 0) {
        clearTimeout(buffered.timer)
        pendingCaptionBuffers.delete(sessionId)
        const prompt = renderPendingPrompt(buffered.fragments)
        console.log(`[agent] Processing buffered caption for ${sessionId}: "${prompt.substring(0, 80)}..."`)
        await executeAgentResponse(sessionId, prompt, loop, tts, bridge, manager)
      } else {
        resetSilenceTimer(sessionId)
      }
    }
  }

  const onCaption = (sessionId: string, caption: CaptionEvent) => {
    if (
      caption.isSelf ||
      echoGuard.shouldIgnoreCaption(sessionId, caption.text)
    ) {
      return
    }

    resetSilenceTimer(sessionId)

    avatarBridge?.broadcastCaption({
      sessionId,
      speaker: caption.speaker,
      text: caption.text,
    })

    handleCaptionWithAgent(sessionId, caption)
  }

  const onSessionUpdate = (session: ManagedSession) => {
    if (session.status === 'ended' || session.status === 'failed' || session.status === 'stopped') {
      echoGuard.clearSession(session.id)
      agentLoop?.clearHistory(session.id)
      clearSilenceTimer(session.id)
      clearPendingCaption(session.id)
      const watchdog = agentWatchdogs.get(session.id)
      if (watchdog) {
        clearTimeout(watchdog)
        agentWatchdogs.delete(session.id)
      }
      void interruptAgentResponse(session.id)
    }

    avatarBridge?.broadcastSessionUpdate({
      sessionId: session.id,
      status: session.status,
      meetingUrl: session.meetingUrl,
    })
  }

  const app = Fastify({ logger: true })

  sessionManager = new SessionManager(appConfig, onCaption, onSessionUpdate)

  app.register(fastifyStatic, {
    root: resolve(import.meta.dirname, '../public'),
    prefix: '/',
    index: ['index.html'],
  })

  app.setNotFoundHandler((_request, reply) => {
    return reply.sendFile('index.html')
  })

  registerRoutes(app, appConfig, sessionManager, headTTS, agentLoop)

  app.addHook('onReady', () => {
    const bridge = new AvatarBridge(app.server)
    app.decorate('avatarBridge', bridge)
    avatarBridge = bridge
  })

  return app
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (
    error.name === 'AbortError' ||
    /aborted/i.test(error.message)
  )
}

function renderPendingPrompt(fragments: Array<{ speaker: string; text: string }>): string {
  if (fragments.length === 0) return ''
  if (fragments.length === 1) {
    return `${fragments[0]!.speaker}: ${fragments[0]!.text}`
  }

  const lines: string[] = []
  let currentSpeaker = ''
  let currentText = ''

  for (const fragment of fragments) {
    if (fragment.speaker === currentSpeaker) {
      currentText = `${currentText} ${fragment.text}`.trim()
    } else {
      if (currentSpeaker) {
        lines.push(`${currentSpeaker}: ${currentText}`)
      }
      currentSpeaker = fragment.speaker
      currentText = fragment.text
    }
  }

  if (currentSpeaker) {
    lines.push(`${currentSpeaker}: ${currentText}`)
  }

  return lines.join('\n')
}
