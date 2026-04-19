import { describe, expect, it } from 'vitest'

import {
  JOIN_BUTTON_SELECTORS,
  inferMeetingAdmissionStatus,
  isBlockedJoinText,
  normalizeCaptionSpeaker,
  shouldForwardCaptionUpdate,
} from '../src/providers/meeting-provider.js'

describe('isBlockedJoinText', () => {
  it('detects explicit Google Meet rejection screens', () => {
    expect(isBlockedJoinText("You can't join this video call")).toBe(true)
    expect(isBlockedJoinText('Returning to home screen in 60 seconds.')).toBe(true)
    expect(isBlockedJoinText('The meeting has been locked by the host')).toBe(true)
  })

  it('does not classify ordinary lobby copy as blocked', () => {
    expect(isBlockedJoinText('Ask to join')).toBe(false)
    expect(isBlockedJoinText("You've been admitted")).toBe(false)
  })
})

describe('JOIN_BUTTON_SELECTORS', () => {
  it('keeps the broader upstream OpenUtter selector set', () => {
    expect(JOIN_BUTTON_SELECTORS).toContain('[data-idom-class*="join"] button')
    expect(JOIN_BUTTON_SELECTORS).toContain('button[jsname="Qx7uuf"]')
  })
})

describe('inferMeetingAdmissionStatus', () => {
  it('does not treat vague lobby text as admitted without in-call UI', () => {
    expect(inferMeetingAdmissionStatus({
      bodyText: 'Only one here right now',
      hasLeaveButton: false,
      hasParticipantTile: false,
      hasMeetingToolbar: false,
      hasJoinAction: false,
      hasNameInput: false,
    })).toBe('unknown')
  })

  it('treats waiting text as still pending admission', () => {
    expect(inferMeetingAdmissionStatus({
      bodyText: 'Waiting for someone to let you in',
      hasLeaveButton: false,
      hasParticipantTile: false,
      hasMeetingToolbar: false,
      hasJoinAction: false,
      hasNameInput: false,
    })).toBe('waiting')
  })

  it('requires actual in-call chrome to mark the meeting as admitted', () => {
    expect(inferMeetingAdmissionStatus({
      bodyText: 'You have been admitted',
      hasLeaveButton: true,
      hasParticipantTile: false,
      hasMeetingToolbar: false,
      hasJoinAction: false,
      hasNameInput: false,
    })).toBe('admitted')
  })

  it('does not treat a generic meeting toolbar alone as admitted', () => {
    expect(inferMeetingAdmissionStatus({
      bodyText: 'Meet',
      hasLeaveButton: false,
      hasParticipantTile: false,
      hasMeetingToolbar: true,
      hasJoinAction: false,
      hasNameInput: false,
    })).toBe('unknown')
  })

  it('does not treat visible join controls as admitted even if a leave button is present', () => {
    expect(inferMeetingAdmissionStatus({
      bodyText: 'Join now',
      hasLeaveButton: true,
      hasParticipantTile: false,
      hasMeetingToolbar: true,
      hasJoinAction: true,
      hasNameInput: false,
    })).toBe('unknown')
  })
})

describe('shouldForwardCaptionUpdate', () => {
  it('forwards longer caption expansions for the same utterance', () => {
    expect(shouldForwardCaptionUpdate('Can you?', 'Can you say hi to Nithara?')).toBe(true)
  })

  it('ignores duplicate or shorter stale partials', () => {
    expect(shouldForwardCaptionUpdate('Can you say hi to Nithara?', 'Can you say hi to Nithara?')).toBe(false)
    expect(shouldForwardCaptionUpdate('Can you say hi to Nithara?', 'Can you?')).toBe(false)
  })

  it('forwards a new unrelated utterance from the same speaker', () => {
    expect(shouldForwardCaptionUpdate('Can you say hi to Nithara?', 'Also ask her about the notes')).toBe(true)
  })
})

describe('normalizeCaptionSpeaker', () => {
  it('treats You as the bot itself (isSelf=true)', () => {
    expect(normalizeCaptionSpeaker('You', 'Meetingbot')).toEqual({
      speaker: 'Meetingbot',
      isSelf: true,
    })
  })

  it('keeps remote speaker names unchanged', () => {
    expect(normalizeCaptionSpeaker('Muhammadali M S', 'Meetingbot')).toEqual({
      speaker: 'Muhammadali M S',
      isSelf: false,
    })
  })

  it('still recognizes explicit bot-name self captions', () => {
    expect(normalizeCaptionSpeaker('Meetingbot', 'Meetingbot')).toEqual({
      speaker: 'Meetingbot',
      isSelf: true,
    })
  })
})
