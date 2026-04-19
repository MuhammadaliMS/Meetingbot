import type {
  AvatarRecommendation,
  AvatarRecommendationRequest,
} from '../domain/types.js'

const sources = {
  agentZero: 'https://github.com/MuhammadaliMS/AgentZero',
  openutter: 'https://github.com/sumansid/openutter',
  pika: 'https://github.com/Pika-Labs/Pika-Skills',
  livekitAvatar: 'https://docs.livekit.io/agents/models/avatar/',
  bithuman: 'https://docs.bithuman.ai/deployment/self-hosted-gpu',
  musetalk: 'https://github.com/TMElyralab/MuseTalk',
  liveportrait: 'https://github.com/KlingAIResearch/LivePortrait',
  azureViseme: 'https://learn.microsoft.com/en-us/azure/ai-services/speech-service/how-to-speech-synthesis-viseme',
  pollyViseme: 'https://docs.aws.amazon.com/polly/latest/dg/viseme.html',
  v4l2loopback: 'https://github.com/v4l2loopback/v4l2loopback',
  recallMeetingBots: 'https://www.recall.ai/blog/what-is-a-meeting-bot',
} as const

export function buildAvatarRecommendation(
  request: AvatarRecommendationRequest,
  allowHostedProviders: boolean,
): AvatarRecommendation {
  if (request.deploymentGoal === 'demo_fast') {
    if (!allowHostedProviders) {
      return {
        provider: 'svg_viseme_avatar',
        summary:
          'Hosted providers are disabled, so the fastest non-hosted path is a lightweight 2D viseme avatar while you finish the outbound media pipeline.',
        reasons: [
          'You asked for speed, but hosted avatar providers are disabled in config.',
          'A 2D viseme avatar can be implemented without a GPU.',
          'It still gives you a face and mouth motion while the meeting joiner matures.',
        ],
        requiredTooling: [
          'openutter',
          'TTS with viseme or word timing',
          'Rive or SVG avatar renderer',
          'virtual camera and virtual microphone plumbing',
        ],
        risks: [
          'Lower realism than a photoreal talking-head model.',
          'You still need to wire camera and mic injection into Meet.',
        ],
        sourceLinks: [
          sources.openutter,
          sources.azureViseme,
          sources.pollyViseme,
          sources.v4l2loopback,
        ],
      }
    }

    return {
      provider: 'pika',
      summary:
        'Use Pika first if the goal is the fastest visible demo of an AI avatar joining and talking in a meeting.',
      reasons: [
        'Pika already exposes the exact product pattern you want through `pikastream-video-meeting`.',
        'It handles avatar image, voice cloning, and live meeting session orchestration.',
        'This avoids the hardest real-time video work during the first milestone.',
      ],
      requiredTooling: [
        'PIKA_DEV_KEY',
        'meeting session orchestration',
        'workspace context prompt builder',
      ],
      risks: [
        'Hosted dependency and usage billing.',
        'Less control over the avatar internals and transport.',
      ],
      sourceLinks: [sources.pika],
    }
  }

  if (
    request.deploymentGoal === 'self_hosted' &&
    request.gpuAvailability !== 'none' &&
    request.needsPhotorealism
  ) {
    return {
      provider: 'bithuman_livekit',
      summary:
        'Use a browser-join bot plus a LiveKit-based avatar worker if you want the lowest-risk self-hosted photoreal path.',
      reasons: [
        'bitHuman already documents a self-hosted GPU container that joins a LiveKit room and renders lip-synced video.',
        'LiveKit already models avatar workers as a secondary participant publishing synchronized audio and video.',
        'This is much lower risk than building a full neural-avatar runtime from scratch.',
      ],
      requiredTooling: [
        'LiveKit server',
        'GPU host with Docker and NVIDIA Container Toolkit',
        'browser automation joiner',
        'audio bridge between the agent and the avatar worker',
      ],
      risks: [
        'Still vendor-dependent even though it is self-hosted.',
        'Requires GPU capacity planning and room lifecycle management.',
      ],
      sourceLinks: [
        sources.livekitAvatar,
        sources.bithuman,
        sources.recallMeetingBots,
      ],
    }
  }

  if (request.deploymentGoal === 'open_source' && request.gpuAvailability !== 'none') {
    return {
      provider: 'musetalk_liveportrait',
      summary:
        'Use MuseTalk for lip-sync and LivePortrait for motion control if you want the most open stack and can afford the engineering complexity.',
      reasons: [
        'MuseTalk 1.5 exposes realtime inference and is positioned for audio-driven lip sync.',
        'LivePortrait adds better portrait motion control than pure mouth-only animation.',
        'The stack stays much more open than a hosted or vendor container path.',
      ],
      requiredTooling: [
        'GPU host',
        'MuseTalk weights and runtime',
        'LivePortrait weights and runtime',
        'v4l2loopback virtual camera',
        'PulseAudio virtual source',
        'browser automation joiner',
      ],
      risks: [
        'Highest implementation complexity.',
        'You own synchronization, queueing, batching, and failure recovery.',
      ],
      sourceLinks: [
        sources.musetalk,
        sources.liveportrait,
        sources.v4l2loopback,
      ],
    }
  }

  return {
    provider: 'svg_viseme_avatar',
    summary:
      'Use a 2D viseme avatar first when GPU is unavailable or realism is less important than getting a talking face into the call.',
    reasons: [
      'Official viseme docs from Azure and Polly make this path straightforward.',
      'It avoids GPU dependency while still giving you deterministic mouth motion.',
      'It is the best fallback while the rest of the meeting bot stack stabilizes.',
    ],
    requiredTooling: [
      'TTS provider with viseme or speech-mark support',
      '2D avatar renderer',
      'virtual camera and audio injection',
      'browser automation joiner',
    ],
    risks: [
      'Stylized rather than photoreal output.',
      'Needs custom expression logic if you want more than mouth motion.',
    ],
    sourceLinks: [
      sources.azureViseme,
      sources.pollyViseme,
      sources.v4l2loopback,
    ],
  }
}
