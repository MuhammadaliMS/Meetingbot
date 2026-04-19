import { randomUUID } from 'node:crypto'
import { WebSocketServer, type WebSocket } from 'ws'
import type { Server } from 'node:http'
import type { AvatarSpeechEvent } from '../domain/types.js'

export interface AvatarClient {
  id: string
  ws: WebSocket
  sessionId?: string
}

export class AvatarBridge {
  private readonly wss: WebSocketServer
  private readonly clients = new Map<string, AvatarClient>()

  constructor(server: Server) {
    this.wss = new WebSocketServer({ server, path: '/ws/avatar' })

    this.wss.on('connection', (ws) => {
      const id = randomUUID()
      const client: AvatarClient = { id, ws }
      this.clients.set(id, client)

      ws.on('close', () => {
        this.clients.delete(id)
      })

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString())
          if (msg.type === 'bind_session' && msg.sessionId) {
            client.sessionId = msg.sessionId
          }
        } catch {}
      })

      this.send(ws, { type: 'connected', clientId: id })
    })
  }

  broadcastAvatarEvent(event: AvatarSpeechEvent): void {
    const payload = { type: 'avatar_speak', ...event }

    for (const client of this.clients.values()) {
      if (event.sessionId && client.sessionId && client.sessionId !== event.sessionId) {
        continue
      }
      this.send(client.ws, payload)
    }
  }

  broadcastCaption(event: { sessionId: string; speaker: string; text: string }): void {
    const payload = { type: 'caption', ...event }

    for (const client of this.clients.values()) {
      if (client.sessionId && client.sessionId !== event.sessionId) {
        continue
      }
      this.send(client.ws, payload)
    }
  }

  broadcastSessionUpdate(event: { sessionId: string; status: string; meetingUrl: string }): void {
    const payload = { type: 'session_update', ...event }
    for (const client of this.clients.values()) {
      this.send(client.ws, payload)
    }
  }

  broadcastAvatarStop(event: { sessionId?: string }): void {
    const payload = { type: 'avatar_stop', ...event }

    for (const client of this.clients.values()) {
      if (event.sessionId && client.sessionId && client.sessionId !== event.sessionId) {
        continue
      }
      this.send(client.ws, payload)
    }
  }

  private send(ws: WebSocket, data: unknown): void {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(data))
    }
  }

  close(): void {
    this.wss.close()
  }
}
