import type { MouthCue, TimedVisemeEvent } from '../domain/types.js'

const visemeShapeMap: Record<string, MouthCue['shape']> = {
  silence: 'closed',
  p: 'pressed',
  b: 'pressed',
  m: 'pressed',
  a: 'wide',
  aa: 'wide',
  ae: 'wide',
  e: 'smile',
  eh: 'smile',
  i: 'smile',
  ih: 'smile',
  o: 'round',
  oh: 'round',
  oo: 'round',
  u: 'round',
  f: 'wide',
  v: 'wide',
  t: 'wide',
  d: 'wide',
  s: 'smile',
  z: 'smile',
}

/**
 * Clamp arbitrary amplitude values into a stable 0..1 range for mouth motion.
 */
export function mouthOpennessFromAmplitude(amplitude: number): number {
  if (Number.isNaN(amplitude) || !Number.isFinite(amplitude)) {
    return 0
  }

  return Math.max(0, Math.min(1, amplitude))
}

/**
 * Convert timed viseme events into a compact mouth-cue timeline that a
 * lightweight renderer can consume.
 */
export function buildMouthCueTimeline(
  events: TimedVisemeEvent[],
  defaultDurationMs: number = 90,
): MouthCue[] {
  if (events.length === 0) {
    return []
  }

  const ordered = [...events].sort((left, right) => left.atMs - right.atMs)
  const cues: MouthCue[] = []

  for (const [index, current] of ordered.entries()) {
    const next = ordered[index + 1]
    const startMs = Math.max(0, current.atMs)
    const requestedEnd = current.durationMs
      ? startMs + current.durationMs
      : startMs + defaultDurationMs
    const nextStart = next?.atMs ?? requestedEnd
    const endMs = Math.max(startMs + 30, Math.min(requestedEnd, nextStart))
    const shape = visemeShapeMap[current.visemeId.toLowerCase()] ?? 'wide'
    const previous = cues[cues.length - 1]

    if (previous && previous.shape === shape && previous.endMs >= startMs) {
      previous.endMs = Math.max(previous.endMs, endMs)
      continue
    }

    cues.push({
      startMs,
      endMs,
      shape,
    })
  }

  return cues
}
