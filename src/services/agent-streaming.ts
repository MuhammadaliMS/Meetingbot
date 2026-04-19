export interface ThinkStripState {
  carry: string
  inThinkBlock: boolean
}

export interface ThinkStripResult {
  visibleText: string
  state: ThinkStripState
}

const THINK_OPEN_TAG = '<think>'
const THINK_CLOSE_TAG = '</think>'

export function stripThinkStreamingChunk(
  chunk: string,
  state: ThinkStripState,
): ThinkStripResult {
  let input = `${state.carry}${chunk}`
  let output = ''
  let index = 0
  let inThinkBlock = state.inThinkBlock

  while (index < input.length) {
    if (inThinkBlock) {
      const closeIndex = input.indexOf(THINK_CLOSE_TAG, index)
      if (closeIndex === -1) {
        const carry = longestPartialTagSuffix(input.slice(index), [THINK_CLOSE_TAG])
        return {
          visibleText: output,
          state: {
            carry,
            inThinkBlock: true,
          },
        }
      }

      index = closeIndex + THINK_CLOSE_TAG.length
      inThinkBlock = false
      continue
    }

    const openIndex = input.indexOf(THINK_OPEN_TAG, index)
    if (openIndex === -1) {
      const remaining = input.slice(index)
      const carry = longestPartialTagSuffix(remaining, [THINK_OPEN_TAG, THINK_CLOSE_TAG])
      output += remaining.slice(0, remaining.length - carry.length)

      return {
        visibleText: output,
        state: {
          carry,
          inThinkBlock,
        },
      }
    }

    output += input.slice(index, openIndex)
    index = openIndex + THINK_OPEN_TAG.length
    inThinkBlock = true
  }

  return {
    visibleText: output,
    state: {
      carry: '',
      inThinkBlock,
    },
  }
}

export function extractReadySentences(text: string): {
  sentences: string[]
  remainder: string
} {
  const sentences: string[] = []
  let cursor = 0

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (!char || !/[.!?]/.test(char)) continue

    let end = index + 1
    while (end < text.length && /["')\]]/.test(text[end] ?? '')) {
      end += 1
    }

    if (end < text.length && !/\s/.test(text[end] ?? '')) {
      continue
    }

    const sentence = text.slice(cursor, end).trim()
    if (sentence) {
      sentences.push(sentence)
    }

    while (end < text.length && /\s/.test(text[end] ?? '')) {
      end += 1
    }

    cursor = end
    index = end - 1
  }

  return {
    sentences,
    remainder: text.slice(cursor).trimStart(),
  }
}

export function getCaptionDebounceMs(text: string): number {
  const trimmed = text.trim()

  if (!trimmed) return 900
  if (/[.!?]["')\]]*$/.test(trimmed)) return 450
  if (trimmed.split(/\s+/).length >= 12) return 650

  return 800
}

function longestPartialTagSuffix(text: string, tags: string[]): string {
  const maxLength = Math.min(text.length, Math.max(...tags.map(tag => tag.length - 1)))

  for (let length = maxLength; length > 0; length -= 1) {
    const suffix = text.slice(-length)
    if (tags.some(tag => tag.startsWith(suffix))) {
      return suffix
    }
  }

  return ''
}
