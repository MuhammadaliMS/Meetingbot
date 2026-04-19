interface SpeechTiming {
  vtimes: number[]
  vdurations: number[]
}

interface RecentSpeech {
  normalizedText: string
  expiresAt: number
}

interface SessionEchoState {
  recentSpeech: RecentSpeech[]
  speakingUntil: number
}

const ECHO_GRACE_MS = 2_500
const ECHO_RETENTION_MS = 12_000

/**
 * Normalizes caption text so self-echo comparisons are resilient to punctuation
 * and Google Meet's incremental caption updates.
 */
export function normalizeCaptionText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Estimates how long a spoken sentence will remain audible based on viseme
 * timings, with a text-length fallback for sparse metadata.
 */
export function estimateSpeechDurationMs(
  text: string,
  timing: SpeechTiming,
): number {
  const lastVisemeEnd = timing.vtimes.reduce((max, atMs, index) => {
    const durationMs = timing.vdurations[index] ?? 0
    return Math.max(max, atMs + durationMs)
  }, 0)

  const textFallbackMs = Math.max(1_200, text.trim().length * 55)
  return Math.max(lastVisemeEnd, textFallbackMs)
}

/**
 * Returns true when an incoming caption is likely to be the bot hearing its
 * own recent speech rather than a real user interruption.
 */
export function isLikelySelfEcho(
  captionText: string,
  spokenText: string,
  aggressivelyMatchPrefixes = false,
): boolean {
  const normalizedCaption = normalizeCaptionText(captionText)
  const normalizedSpeech = normalizeCaptionText(spokenText)

  if (!normalizedCaption || !normalizedSpeech) {
    return false
  }

  if (normalizedCaption === normalizedSpeech) {
    return true
  }

  const shorter = normalizedCaption.length <= normalizedSpeech.length
    ? normalizedCaption
    : normalizedSpeech
  const longer = shorter === normalizedCaption
    ? normalizedSpeech
    : normalizedCaption

  const shorterWords = shorter.split(' ').filter(Boolean)
  const longerWords = longer.split(' ').filter(Boolean)
  const prefixMatchWords = countLeadingSharedWords(shorterWords, longerWords)
  const minPrefixWords = aggressivelyMatchPrefixes ? 1 : 2
  const minPrefixLength = aggressivelyMatchPrefixes ? 4 : 8

  if (
    (longer.startsWith(shorter) || shorter.startsWith(longer)) &&
    (shorter.length >= minPrefixLength || prefixMatchWords >= minPrefixWords)
  ) {
    return true
  }

  if (shorterWords.length >= 3) {
    const captionWordSet = new Set(normalizedCaption.split(' ').filter(Boolean))
    const speechWordSet = new Set(normalizedSpeech.split(' ').filter(Boolean))
    let overlap = 0

    for (const word of captionWordSet) {
      if (speechWordSet.has(word)) {
        overlap += 1
      }
    }

    const minWordCount = Math.min(captionWordSet.size, speechWordSet.size)
    if (minWordCount > 0 && overlap / minWordCount >= 0.8) {
      return true
    }
  }

  return false
}

/**
 * Tracks the bot's recent speech per session so self-generated captions can be
 * ignored without blocking genuine user interruptions.
 */
export class EchoGuard {
  private readonly sessions = new Map<string, SessionEchoState>()

  noteBotSpeech(
    sessionId: string,
    text: string,
    timing: SpeechTiming,
    now = Date.now(),
  ): void {
    const normalizedText = normalizeCaptionText(text)
    if (!normalizedText) {
      return
    }

    const durationMs = estimateSpeechDurationMs(text, timing)
    const state = this.getSessionState(sessionId)
    state.recentSpeech.push({
      normalizedText,
      expiresAt: now + durationMs + ECHO_RETENTION_MS,
    })
    state.speakingUntil = Math.max(state.speakingUntil, now + durationMs + ECHO_GRACE_MS)
    this.pruneState(state, now)
  }

  shouldIgnoreCaption(
    sessionId: string,
    captionText: string,
    now = Date.now(),
  ): boolean {
    const normalizedCaption = normalizeCaptionText(captionText)
    if (!normalizedCaption) {
      return false
    }

    const state = this.sessions.get(sessionId)
    if (!state) {
      return false
    }

    this.pruneState(state, now)
    const aggressivelyMatchPrefixes = now <= state.speakingUntil

    return state.recentSpeech.some((entry) =>
      isLikelySelfEcho(normalizedCaption, entry.normalizedText, aggressivelyMatchPrefixes),
    )
  }

  clearSession(sessionId: string): void {
    this.sessions.delete(sessionId)
  }

  private getSessionState(sessionId: string): SessionEchoState {
    let state = this.sessions.get(sessionId)
    if (!state) {
      state = {
        recentSpeech: [],
        speakingUntil: 0,
      }
      this.sessions.set(sessionId, state)
    }
    return state
  }

  private pruneState(state: SessionEchoState, now: number): void {
    state.recentSpeech = state.recentSpeech.filter((entry) => entry.expiresAt > now)
    if (state.speakingUntil < now) {
      state.speakingUntil = 0
    }
  }
}

function countLeadingSharedWords(left: string[], right: string[]): number {
  const limit = Math.min(left.length, right.length)
  let count = 0

  for (let index = 0; index < limit; index += 1) {
    if (left[index] !== right[index]) {
      break
    }
    count += 1
  }

  return count
}
