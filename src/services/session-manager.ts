import { randomUUID } from 'node:crypto'

import type { AppConfig } from '../config.js'
import type { ManagedSession, OpenUtterJoinRequest } from '../domain/types.js'
import { createOpenUtterSession, type CaptionEvent, type OpenUtterRuntimeSession } from '../providers/openutter-provider.js'
import { createMeetingSession, type MeetingRuntimeSession } from '../providers/meeting-provider.js'

export type ProviderMode = 'direct' | 'openutter'

export class SessionManager {
  private readonly appConfig: AppConfig
  private readonly onCaption: ((sessionId: string, caption: CaptionEvent) => void) | undefined
  private readonly onSessionUpdate: ((session: ManagedSession) => void) | undefined

  private readonly sessions = new Map<string, ManagedSession>()

  private readonly openutterRuntimes = new Map<string, OpenUtterRuntimeSession>()

  private readonly meetingRuntimes = new Map<string, MeetingRuntimeSession>()

  constructor(
    appConfig: AppConfig,
    onCaption?: (sessionId: string, caption: CaptionEvent) => void,
    onSessionUpdate?: (session: ManagedSession) => void,
  ) {
    this.appConfig = appConfig
    this.onCaption = onCaption
    this.onSessionUpdate = onSessionUpdate
  }

  private storeSession(session: ManagedSession): void {
    this.sessions.set(session.id, session)
    this.onSessionUpdate?.(session)
  }

  startSession(input: OpenUtterJoinRequest & { provider?: ProviderMode }): ManagedSession {
    const mode = input.provider ?? 'direct'

    if (mode === 'direct') {
      return this.startDirectSession(input)
    }

    return this.startOpenUtterSession(input)
  }

  private startDirectSession(input: OpenUtterJoinRequest): ManagedSession {
    const sessionId = randomUUID()

    const pendingSession: ManagedSession = {
      id: sessionId,
      provider: 'direct',
      status: 'starting',
      meetingUrl: input.meetingUrl,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      logs: ['Initializing direct Playwright session...'],
    }
    this.storeSession(pendingSession)

    createMeetingSession(
      input,
      this.appConfig,
      (session) => {
        this.storeSession(session)
      },
      this.onCaption,
      sessionId,
    ).then((runtime) => {
      this.storeSession(runtime.session)
      this.meetingRuntimes.set(runtime.session.id, runtime)
    }).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err)
      const current = this.sessions.get(sessionId)
      if (current) {
        current.status = 'failed'
        current.updatedAt = new Date().toISOString()
        current.logs = [...current.logs.slice(-49), `Failed: ${msg}`]
        this.storeSession({ ...current })
      }
    })

    return pendingSession
  }

  private startOpenUtterSession(input: OpenUtterJoinRequest): ManagedSession {
    const runtime = createOpenUtterSession(
      input,
      this.appConfig,
      (session) => {
        this.storeSession(session)
      },
      this.onCaption,
    )

    this.storeSession(runtime.session)
    this.openutterRuntimes.set(runtime.session.id, runtime)

    return runtime.session
  }

  getMeetingRuntime(sessionId: string): MeetingRuntimeSession | undefined {
    return this.meetingRuntimes.get(sessionId)
  }

  stopSession(sessionId: string): ManagedSession | null {
    const meetingRuntime = this.meetingRuntimes.get(sessionId)
    if (meetingRuntime) {
      meetingRuntime.close().catch(() => {})
      this.meetingRuntimes.delete(sessionId)
      const session = this.sessions.get(sessionId)
      if (session) {
        const next: ManagedSession = { ...session, status: 'stopped', updatedAt: new Date().toISOString() }
        this.storeSession(next)
        return next
      }
      return null
    }

    const openutterRuntime = this.openutterRuntimes.get(sessionId)
    const session = this.sessions.get(sessionId)
    if (!openutterRuntime || !session) return null

    openutterRuntime.process.kill('SIGTERM')
    this.openutterRuntimes.delete(sessionId)
    const next: ManagedSession = { ...session, status: 'stopped', updatedAt: new Date().toISOString() }
    this.storeSession(next)
    return next
  }

  listSessions(): ManagedSession[] {
    return [...this.sessions.values()].sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt),
    )
  }

  getSession(sessionId: string): ManagedSession | null {
    return this.sessions.get(sessionId) ?? null
  }
}
