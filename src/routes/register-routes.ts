import { z } from 'zod'
import type { FastifyInstance } from 'fastify'

import type { AppConfig } from '../config.js'
import type {
  AvatarRecommendationRequest,
  OpenUtterJoinRequest,
} from '../domain/types.js'
import { SessionManager } from '../services/session-manager.js'
import { buildAvatarRecommendation } from '../services/avatar-strategy.js'
import { HeadTTSProvider } from '../providers/headtts-provider.js'
import { AgentLoop } from '../services/agent-loop.js'

const avatarRecommendationSchema = z.object({
  meetingPlatform: z.enum(['google_meet', 'zoom', 'teams']),
  deploymentGoal: z.enum(['demo_fast', 'self_hosted', 'open_source']),
  gpuAvailability: z.enum(['none', 'consumer', 'datacenter']),
  needsPhotorealism: z.boolean(),
  needsLowLatency: z.boolean(),
})

const openUtterJoinSchema = z.object({
  meetingUrl: z.string().url(),
  joinMode: z.enum(['auth', 'anon']),
  botName: z.string().min(1).optional(),
  headed: z.boolean().optional(),
  duration: z.string().min(1).optional(),
  provider: z.enum(['direct', 'openutter']).optional(),
})

const speakSchema = z.object({
  text: z.string().min(1),
  voice: z.string().optional(),
  speed: z.number().min(0.25).max(4).optional(),
  sessionId: z.string().optional(),
})

const chatSchema = z.object({
  message: z.string().min(1),
  sessionId: z.string().optional(),
})

export function registerRoutes(
  app: FastifyInstance,
  appConfig: AppConfig,
  sessionManager: SessionManager,
  headTTS: HeadTTSProvider,
  agentLoop: AgentLoop | null,
): void {
  app.get('/health', async () => ({
    status: 'ok',
    openutterBin: appConfig.OPENUTTER_BIN,
    allowHostedAvatarProviders: appConfig.ALLOW_HOSTED_AVATAR_PROVIDERS,
    headTTSUrl: appConfig.HEADTTS_URL,
    agentConfigured: !!agentLoop,
  }))

  app.post('/avatar/recommendation', async (request, reply) => {
    const parsed = avatarRecommendationSchema.safeParse(request.body)

    if (!parsed.success) {
      return reply.status(400).send({
        error: parsed.error.flatten(),
      })
    }

    const body: AvatarRecommendationRequest = parsed.data
    const recommendation = buildAvatarRecommendation(
      body,
      appConfig.ALLOW_HOSTED_AVATAR_PROVIDERS,
    )

    return reply.send(recommendation)
  })

  app.post('/sessions/openutter', async (request, reply) => {
    const parsed = openUtterJoinSchema.safeParse(request.body)

    if (!parsed.success) {
      return reply.status(400).send({
        error: parsed.error.flatten(),
      })
    }

    const body: OpenUtterJoinRequest = parsed.data

    if (body.joinMode === 'anon' && !body.botName) {
      return reply.status(400).send({
        error: 'botName is required when joinMode=anon',
      })
    }

    const session = sessionManager.startSession({
      ...body,
      provider: body.provider ?? 'direct',
    })
    return reply.status(201).send(session)
  })

  app.get('/sessions', async () => sessionManager.listSessions())

  app.get('/sessions/:id', async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params)

    if (!params.success) {
      return reply.status(400).send({
        error: params.error.flatten(),
      })
    }

    const session = sessionManager.getSession(params.data.id)

    if (!session) {
      return reply.status(404).send({
        error: 'session not found',
      })
    }

    return reply.send(session)
  })

  app.post('/sessions/:id/stop', async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params)

    if (!params.success) {
      return reply.status(400).send({
        error: params.error.flatten(),
      })
    }

    const session = sessionManager.stopSession(params.data.id)

    if (!session) {
      return reply.status(404).send({
        error: 'session not found',
      })
    }

    return reply.send(session)
  })

  app.post('/sessions/:id/inject-audio', async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params)
    if (!params.success) {
      return reply.status(400).send({ error: params.error.flatten() })
    }

    const body = z.object({ audioBase64: z.string().min(1) }).safeParse(request.body)
    if (!body.success) {
      return reply.status(400).send({ error: body.error.flatten() })
    }

    const runtime = sessionManager.getMeetingRuntime(params.data.id)
    if (!runtime) {
      return reply.status(404).send({ error: 'Meeting runtime not found (must use direct provider)' })
    }

    try {
      await runtime.injectAudio(body.data.audioBase64)
      return reply.send({ status: 'ok' })
    } catch (error) {
      return reply.status(502).send({ error: `Audio injection failed: ${(error as Error).message}` })
    }
  })

  app.post('/speak', async (request, reply) => {
    const parsed = speakSchema.safeParse(request.body)

    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() })
    }

    const { text, voice, speed, sessionId } = parsed.data

    try {
      const result = await headTTS.synthesize({
        input: text,
        voice: voice ?? appConfig.HEADTTS_VOICE,
        speed,
      })

      const avatarBridge = (app as any).avatarBridge
      if (avatarBridge) {
        avatarBridge.broadcastAvatarEvent({
          sessionId,
          audioBase64: result.audio,
          visemes: result.visemes,
          vtimes: result.vtimes,
          vdurations: result.vdurations,
          text,
        })
      }

      if (sessionId) {
        const runtime = sessionManager.getMeetingRuntime(sessionId)
        if (runtime) {
          await runtime.injectSpeech({
            audioBase64: result.audio,
            visemes: result.visemes,
            vtimes: result.vtimes,
            vdurations: result.vdurations,
            text,
          })
        }
      }

      return reply.send({
        audio: result.audio,
        visemes: result.visemes,
        vtimes: result.vtimes,
        vdurations: result.vdurations,
        words: result.words,
        phonemes: result.phonemes,
      })
    } catch (error) {
      return reply.status(502).send({
        error: `HeadTTS synthesis failed: ${(error as Error).message}`,
      })
    }
  })

  app.post('/chat', async (request, reply) => {
    if (!agentLoop) {
      return reply.status(503).send({ error: 'Agent not configured. Set MINIMAX_API_KEY.' })
    }

    const parsed = chatSchema.safeParse(request.body)

    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() })
    }

    const { message, sessionId } = parsed.data

    try {
      const agentText = await agentLoop.getResponse(message, undefined, sessionId ?? 'manual-chat')

      const ttsResult = await headTTS.synthesize({
        input: agentText,
        voice: appConfig.HEADTTS_VOICE,
      })

      const avatarBridge = (app as any).avatarBridge
      if (avatarBridge) {
        avatarBridge.broadcastAvatarEvent({
          sessionId,
          audioBase64: ttsResult.audio,
          visemes: ttsResult.visemes,
          vtimes: ttsResult.vtimes,
          vdurations: ttsResult.vdurations,
          text: agentText,
        })
      }

      if (sessionId) {
        const runtime = sessionManager.getMeetingRuntime(sessionId)
        if (runtime) {
          await runtime.injectSpeech({
            audioBase64: ttsResult.audio,
            visemes: ttsResult.visemes,
            vtimes: ttsResult.vtimes,
            vdurations: ttsResult.vdurations,
            text: agentText,
          })
        }
      }

      return reply.send({
        agentText,
        audio: ttsResult.audio,
        visemes: ttsResult.visemes,
        vtimes: ttsResult.vtimes,
        vdurations: ttsResult.vdurations,
      })
    } catch (error) {
      return reply.status(502).send({
        error: `Chat failed: ${(error as Error).message}`,
      })
    }
  })
}
