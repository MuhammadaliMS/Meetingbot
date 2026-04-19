import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'

import type { AppConfig } from '../config.js'
import type { ManagedSession, OpenUtterJoinRequest } from '../domain/types.js'

export interface OpenUtterRuntimeSession {
  session: ManagedSession
  process: ChildProcessWithoutNullStreams
}

export interface CaptionEvent {
  speaker: string
  text: string
  timestamp: string
  isSelf?: boolean
}

function appendLog(logs: string[], chunk: string): string[] {
  const nextLogs = [...logs, chunk.trim()]
  return nextLogs.slice(-50)
}

function parseCaptionLine(line: string): CaptionEvent | null {
  const match = line.match(/\[caption\]\s+\[(\d{2}:\d{2}:\d{2})\]\s+(.+?):\s+(.+)/)
  if (!match) return null
  return { timestamp: match[1]!, speaker: match[2]!.trim(), text: match[3]!.trim() }
}

export function createOpenUtterSession(
  input: OpenUtterJoinRequest,
  appConfig: AppConfig,
  onUpdate: (session: ManagedSession) => void,
  onCaption?: (sessionId: string, caption: CaptionEvent) => void,
): OpenUtterRuntimeSession {
  const sessionId = randomUUID()
  const args = ['openutter', 'join', input.meetingUrl, `--${input.joinMode}`, '--verbose']

  if (input.joinMode === 'anon' && input.botName != null) {
    args.push('--bot-name', input.botName)
  }

  if (input.headed) {
    args.push('--headed')
  }

  if (input.duration) {
    args.push('--duration', input.duration)
  }

  const session: ManagedSession = {
    id: sessionId,
    provider: 'openutter',
    status: 'starting',
    meetingUrl: input.meetingUrl,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    logs: [],
  }

  const child = spawn(appConfig.OPENUTTER_BIN, args, {
    cwd: appConfig.OPENUTTER_CWD,
    env: process.env,
    stdio: 'pipe',
  })

  session.processId = child.pid
  onUpdate(session)

  const updateFromLine = (line: string): void => {
    const trimmed = line.trim()
    const next = { ...session, updatedAt: new Date().toISOString() }

    if (trimmed.includes('Trying to join') || trimmed.includes('Waiting to be admitted')) {
      next.status = 'joining'
    }

    if (trimmed.startsWith('[OPENUTTER_JOINED]')) {
      next.status = 'joined'
    }

    if (trimmed.startsWith('[OPENUTTER_TRANSCRIPT]')) {
      next.transcriptPath = trimmed.replace('[OPENUTTER_TRANSCRIPT]', '').trim()
      if (next.status !== 'failed' && next.status !== 'stopped') {
        next.status = 'ended'
      }
    }

    if (trimmed.startsWith('[OPENUTTER_DEBUG_IMAGE]')) {
      next.debugImagePath = trimmed.replace('[OPENUTTER_DEBUG_IMAGE]', '').trim()
      if (next.status !== 'stopped') {
        next.status = 'failed'
      }
    }

    const caption = parseCaptionLine(trimmed)
    if (caption && onCaption) {
      onCaption(sessionId, caption)
    }

    if (trimmed.length > 0) {
      next.logs = appendLog(session.logs, trimmed)
    }

    Object.assign(session, next)
    onUpdate({ ...session })
  }

  const bindStream = (stream: NodeJS.ReadableStream): void => {
    let buffer = ''

    stream.on('data', (chunk: Buffer | string) => {
      buffer += chunk.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        updateFromLine(line)
      }
    })
  }

  bindStream(child.stdout)
  bindStream(child.stderr)

  child.on('close', (code) => {
    const nextStatus =
      session.status === 'stopped'
        ? 'stopped'
        : code === 0
          ? session.status === 'joined'
            ? 'ended'
            : session.status
          : 'failed'

    Object.assign(session, {
      status: nextStatus,
      updatedAt: new Date().toISOString(),
    })
    onUpdate({ ...session })
  })

  child.on('error', (error) => {
    Object.assign(session, {
      status: 'failed',
      updatedAt: new Date().toISOString(),
      logs: appendLog(session.logs, error.message),
    })
    onUpdate({ ...session })
  })

  return {
    session,
    process: child,
  }
}
