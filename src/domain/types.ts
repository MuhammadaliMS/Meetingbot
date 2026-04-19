export type MeetingPlatform = 'google_meet' | 'zoom' | 'teams'

export type DeploymentGoal = 'demo_fast' | 'self_hosted' | 'open_source'

export type GpuAvailability = 'none' | 'consumer' | 'datacenter'

export type AvatarProviderId =
  | 'pika'
  | 'bithuman_livekit'
  | 'musetalk_liveportrait'
  | 'svg_viseme_avatar'

export interface AvatarRecommendationRequest {
  meetingPlatform: MeetingPlatform
  deploymentGoal: DeploymentGoal
  gpuAvailability: GpuAvailability
  needsPhotorealism: boolean
  needsLowLatency: boolean
}

export interface AvatarRecommendation {
  provider: AvatarProviderId
  summary: string
  reasons: string[]
  requiredTooling: string[]
  risks: string[]
  sourceLinks: string[]
}

export type OpenUtterJoinMode = 'auth' | 'anon'

export interface OpenUtterJoinRequest {
  meetingUrl: string
  joinMode: OpenUtterJoinMode
  botName?: string | undefined
  headed?: boolean | undefined
  duration?: string | undefined
  provider?: 'direct' | 'openutter' | undefined
}

export type SessionStatus =
  | 'starting'
  | 'joining'
  | 'joined'
  | 'ended'
  | 'failed'
  | 'stopped'

export interface ManagedSession {
  id: string
  provider: 'openutter' | 'direct'
  status: SessionStatus
  meetingUrl: string
  transcriptPath?: string | undefined
  debugImagePath?: string | undefined
  processId?: number | undefined
  startedAt: string
  updatedAt: string
  logs: string[]
}

export interface TimedVisemeEvent {
  atMs: number
  visemeId: string
  durationMs?: number
}

export interface MouthCue {
  startMs: number
  endMs: number
  shape: 'closed' | 'wide' | 'round' | 'pressed' | 'smile'
}

export interface AvatarSpeechEvent {
  sessionId?: string
  audioBase64: string
  visemes: string[]
  vtimes: number[]
  vdurations: number[]
  text: string
}
