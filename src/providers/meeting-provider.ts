import { existsSync, mkdirSync, readFileSync, unlinkSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

import type { Page, BrowserContext } from 'playwright-core'

import type { AppConfig } from '../config.js'
import type { AvatarSpeechEvent, ManagedSession, OpenUtterJoinRequest } from '../domain/types.js'
import type { CaptionEvent } from './openutter-provider.js'
import { MEETING_MEDIA_INJECTION_SCRIPT } from '../avatar/meeting-media-script.js'
import { getCaptionDebounceMs } from '../services/agent-streaming.js'

const OPENUTTER_DIR = join(homedir(), '.openutter')
const CONFIG_FILE = join(OPENUTTER_DIR, 'config.json')
const AUTH_FILE = join(OPENUTTER_DIR, 'auth.json')
const USER_DATA_DIR = join(OPENUTTER_DIR, 'chrome-profile')
const DEBUG_DIR = join(homedir(), '.meetingbot', 'debug')

function cleanStaleChromeProfile(): void {
  const lockfile = join(USER_DATA_DIR, 'SingletonLock')
  try {
    if (existsSync(lockfile)) {
      unlinkSync(lockfile)
    }
    const socketDir = join(USER_DATA_DIR, 'SingletonSocket')
    if (existsSync(socketDir)) {
      unlinkSync(socketDir)
    }
    const cookieFile = join(USER_DATA_DIR, 'SingletonCookie')
    if (existsSync(cookieFile)) {
      unlinkSync(cookieFile)
    }
  } catch {}
}

async function killOrphanChromeProcesses(): Promise<void> {
  try {
    const { execSync } = await import('node:child_process')
    const escaped = USER_DATA_DIR.replace(/\//g, '\\/')
    const result = execSync(
      `pgrep -f 'chrome.*${escaped}' || true`,
      { encoding: 'utf-8', timeout: 3000 },
    )
    const pids = result.trim().split('\n').filter(Boolean)
    for (const pid of pids) {
      try {
        process.kill(Number(pid.trim()), 'SIGKILL')
      } catch {}
    }
    if (pids.length > 0) {
      cleanStaleChromeProfile()
    }
  } catch {}
}

export interface MeetingRuntimeSession {
  session: ManagedSession
  context: BrowserContext
  page: Page
  injectAudio: (wavBase64: string) => Promise<void>
  injectSpeech: (payload: Omit<AvatarSpeechEvent, 'sessionId'>) => Promise<void>
  stopAudio: () => Promise<void>
  close: () => Promise<void>
}

const STEALTH_SCRIPT = `
  Object.defineProperty(navigator, "webdriver", { get: () => false });
  if (!window.chrome) { window.chrome = { runtime: {} }; }
  Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });
  Object.defineProperty(navigator, "languages", { get: () => ["en-US", "en"] });
  const originalQuery = window.Permissions?.prototype?.query;
  if (originalQuery) {
    window.Permissions.prototype.query = function (params) {
      if (params.name === "notifications") return Promise.resolve({ state: "default", onchange: null });
      return originalQuery.call(this, params);
    };
  }
  const getParameter = WebGLRenderingContext.prototype.getParameter;
  WebGLRenderingContext.prototype.getParameter = function (param) {
    if (param === 37445) return "Google Inc. (Apple)";
    if (param === 37446) return "ANGLE (Apple, Apple M1, OpenGL 4.1)";
    return getParameter.call(this, param);
  };
`

const CAPTION_OBSERVER_SCRIPT = `
(function() {
  var BADGE_SEL = ".NWpY1d, .xoMHSc";
  var captionContainer = null;
  var callCount = 0;

  var getSpeaker = function(node) {
    if (!node || !node.querySelector) return "";
    var badge = node.querySelector(BADGE_SEL);
    return badge ? badge.textContent.trim() : "";
  };

  var getText = function(node) {
    if (!node || !node.cloneNode) return "";
    var clone = node.cloneNode(true);
    var badges = clone.querySelectorAll ? clone.querySelectorAll(BADGE_SEL) : [];
    for (var i = 0; i < badges.length; i++) badges[i].remove();
    var imgs = clone.querySelectorAll ? clone.querySelectorAll("img") : [];
    for (var j = 0; j < imgs.length; j++) imgs[j].remove();
    return clone.textContent.trim();
  };

  var send = function(node) {
    if (!(node instanceof HTMLElement)) return;
    var el = node;
    var speaker = "";
    for (var depth = 0; depth < 6 && el && el !== document.body; depth++) {
      speaker = getSpeaker(el);
      if (speaker) break;
      el = el.parentElement;
    }
    if (!speaker || !el) return;
    var text = getText(el);
    if (!text || text.length > 500) return;
    if (/^(mic_off|videocam|call_end|more_vert|keyboard|arrow_)/i.test(text)) return;
    if (text.indexOf("extension") !== -1 && text.indexOf("developers.google") !== -1) return;
    callCount++;
    try { window.__meetingbot_onCaption(speaker, text); } catch(e) {}
  };

  var observer = new MutationObserver(function(mutations) {
    if (!captionContainer || !document.contains(captionContainer)) {
      captionContainer = document.querySelector('[aria-label="Captions"]') ||
                         document.querySelector('[aria-live]');
    }
    for (var i = 0; i < mutations.length; i++) {
      var m = mutations[i];
      if (captionContainer && !captionContainer.contains(m.target)) continue;
      var added = m.addedNodes;
      for (var j = 0; j < added.length; j++) {
        if (added[j] instanceof HTMLElement) send(added[j]);
      }
      if (m.type === "characterData" && m.target && m.target.parentElement) {
        send(m.target.parentElement);
      }
    }
  });
  observer.observe(document.body, { childList: true, characterData: true, subtree: true });

  window.__meetingbot_captionObserver = {
    getAlive: function() { return observer !== null; },
    getCallCount: function() { return callCount; },
    reinject: function() {
      try { observer.disconnect(); } catch(e) {}
      captionContainer = null;
      observer = new MutationObserver(arguments.callee.__originalCallback || function() {});
    }
  };
})();
`

function normalizeForCompare(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()
}

export function shouldForwardCaptionUpdate(
  previousText: string | undefined,
  nextText: string,
): boolean {
  if (!previousText) {
    return true
  }

  const normOld = normalizeForCompare(previousText)
  const normNew = normalizeForCompare(nextText)

  if (!normNew) {
    return false
  }

  if (normNew === normOld) {
    return false
  }

  if (normOld && normNew.startsWith(normOld)) {
    return true
  }

  if (normOld && normOld.startsWith(normNew)) {
    return false
  }

  return true
}

export function normalizeCaptionSpeaker(
  rawSpeaker: string,
  botName: string,
): { speaker: string; isSelf: boolean } {
  const trimmed = rawSpeaker.trim()
  const normalized = trimmed.toLowerCase()
  const normalizedBot = botName.trim().toLowerCase()

  if (
    normalized === normalizedBot ||
    normalized === `${normalizedBot} (you)` ||
    normalized === 'you'
  ) {
    return {
      speaker: botName,
      isSelf: true,
    }
  }

  return {
    speaker: trimmed,
    isSelf: false,
  }
}

export function isBlockedJoinText(text: string): boolean {
  return (
    /you can.t join this video call/i.test(text) ||
    /return(ing)? to home screen/i.test(text) ||
    /you have been removed/i.test(text) ||
    /denied your request/i.test(text) ||
    /meeting has been locked/i.test(text)
  )
}

export const JOIN_BUTTON_SELECTORS = [
  'button:has-text("Continue without microphone and camera")',
  'button:has-text("Ask to join")',
  'button:has-text("Join now")',
  'button:has-text("Join meeting")',
  'button:has-text("Join")',
  'button[jsname="Qx7uuf"]',
  '[data-idom-class*="join"] button',
  'button >> text=/join/i',
] as const

export interface MeetingAdmissionSnapshot {
  bodyText: string
  hasLeaveButton: boolean
  hasParticipantTile: boolean
  hasMeetingToolbar: boolean
  hasJoinAction: boolean
  hasNameInput: boolean
}

export function inferMeetingAdmissionStatus(
  snapshot: MeetingAdmissionSnapshot,
): 'waiting' | 'admitted' | 'ended' | 'unknown' {
  const bodyText = snapshot.bodyText.toLowerCase()

  if (
    bodyText.includes('asking to be let in') ||
    bodyText.includes('waiting for someone') ||
    bodyText.includes('someone in the meeting needs to let you in')
  ) {
    return 'waiting'
  }

  if (
    bodyText.includes('you left the meeting') ||
    bodyText.includes('the meeting has ended') ||
    bodyText.includes('removed from the meeting')
  ) {
    return 'ended'
  }

  if (snapshot.hasJoinAction || snapshot.hasNameInput) {
    return 'unknown'
  }

  if (snapshot.hasLeaveButton || snapshot.hasParticipantTile) {
    return 'admitted'
  }

  return 'unknown'
}

function buildAdmissionSnapshotScript(): string {
  return `(() => {
    const isVisible = (el) => {
      if (!(el instanceof HTMLElement)) return false;
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        style.opacity !== '0' &&
        rect.width > 0 &&
        rect.height > 0;
    };

    const hasJoinAction = Array.from(document.querySelectorAll('button, [role="button"]')).some((el) => {
      if (!isVisible(el)) return false;
      const text = ((el.textContent || '') + ' ' + (el.getAttribute('aria-label') || '')).toLowerCase();
      return /continue without microphone and camera|ask to join|join now|join meeting|join/.test(text);
    });

    const hasNameInput = Array.from(document.querySelectorAll('input')).some((el) => {
      if (!isVisible(el)) return false;
      const label = ((el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('placeholder') || '')).toLowerCase();
      return /your name|name/.test(label);
    });

    return {
      bodyText: document.body.innerText || '',
      hasLeaveButton: !!document.querySelector(
        '[aria-label*="Leave call" i], [aria-label*="End call" i], [data-tooltip*="Leave call" i]',
      ),
      hasParticipantTile: !!document.querySelector('[data-participant-id]'),
      hasMeetingToolbar: !!document.querySelector(
        '[aria-label*="meeting" i][role="toolbar"], [jsname="A5il2e"], button[aria-label*="Turn on captions" i], button[aria-label*="Turn off captions" i]',
      ),
      hasJoinAction,
      hasNameInput,
    };
  })()`
}

async function getMeetingAdmissionSnapshot(page: Page): Promise<MeetingAdmissionSnapshot> {
  return page.evaluate(buildAdmissionSnapshotScript()).then((snapshot) => (
    snapshot as MeetingAdmissionSnapshot
  )).catch(() => ({
    bodyText: '',
    hasLeaveButton: false,
    hasParticipantTile: false,
    hasMeetingToolbar: false,
    hasJoinAction: false,
    hasNameInput: false,
  }))
}

async function dismissOverlays(page: Page): Promise<void> {
  const dismissTexts = ['Got it', 'Dismiss', 'OK', 'Accept all', 'Continue without microphone', 'No thanks']
  for (let round = 0; round < 3; round++) {
    let dismissed = false
    for (const text of dismissTexts) {
      try {
        const btn = page.locator(`button:has-text("${text}")`).first()
        if (await btn.isVisible({ timeout: 1500 })) {
          await btn.click()
          dismissed = true
          await page.waitForTimeout(500)
        }
      } catch {}
    }
    try {
      const gemini = page.locator('text=/Use Gemini/i').first()
      if (await gemini.isVisible({ timeout: 1000 })) {
        await page.keyboard.press('Escape')
        dismissed = true
        await page.waitForTimeout(500)
      }
    } catch {}
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
    if (!dismissed) break
  }
}

async function dismissPostJoinDialogs(page: Page): Promise<void> {
  await page.waitForTimeout(2000)
  for (let round = 0; round < 3; round++) {
    let dismissed = false
    for (const text of ['Got it', 'OK', 'Dismiss', 'Close']) {
      try {
        const btn = page.locator(`button:has-text("${text}")`).first()
        if (await btn.isVisible({ timeout: 1000 })) {
          await btn.click()
          dismissed = true
          await page.waitForTimeout(500)
        }
      } catch {}
    }
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
    if (!dismissed) break
  }
}

async function configureMediaOnPreJoin(
  page: Page,
  opts: { cameraEnabled: boolean; micEnabled: boolean },
): Promise<void> {
  await setMediaToggle(page, 'microphone', opts.micEnabled)
  await setMediaToggle(page, 'camera', opts.cameraEnabled)
}

async function setMediaToggle(
  page: Page,
  kind: 'camera' | 'microphone',
  enabled: boolean,
): Promise<void> {
  const toggleKeyword = kind === 'camera' ? 'camera' : 'microphone'
  const turnOn = page.locator(
    `[aria-label*="Turn on ${toggleKeyword}" i], button[aria-label*="Turn on ${toggleKeyword}" i], ` +
    `[aria-label*="${toggleKeyword}" i][data-is-muted="true"], button[aria-label*="${toggleKeyword}" i][data-is-muted="true"]`,
  ).first()
  const turnOff = page.locator(
    `[aria-label*="Turn off ${toggleKeyword}" i], button[aria-label*="Turn off ${toggleKeyword}" i], ` +
    `[aria-label*="${toggleKeyword}" i][data-is-muted="false"], button[aria-label*="${toggleKeyword}" i][data-is-muted="false"]`,
  ).first()

  try {
    if (enabled) {
      if (await turnOn.isVisible({ timeout: 1_500 })) {
        await turnOn.click()
        await page.waitForTimeout(300)
      }
      return
    }

    if (await turnOff.isVisible({ timeout: 1_500 })) {
      await turnOff.click()
      await page.waitForTimeout(300)
    }
  } catch {}
}

async function enterNameIfNeeded(page: Page, botName: string): Promise<void> {
  try {
    const nameInput = page.locator('input[aria-label="Your name"], input[placeholder*="name" i]').first()
    if (await nameInput.isVisible({ timeout: 3000 })) {
      await nameInput.fill(botName)
    }
  } catch {}
}

async function clickJoinButton(page: Page, maxAttempts = 6): Promise<boolean> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const isBlocked = await page.evaluate(() => {
      const text = document.body.innerText || ''
      return (
        /you can.t join this video call/i.test(text) ||
        /return(ing)? to home screen/i.test(text)
      )
    }).catch(() => false)

    if (isBlocked) {
      return false
    }

    for (const selector of JOIN_BUTTON_SELECTORS) {
      try {
        const btn = page.locator(selector).first()
        if (await btn.isVisible({ timeout: 2000 })) {
          await btn.click()
          return true
        }
      } catch {}
    }
    if (attempt < maxAttempts - 1) await page.waitForTimeout(5000)
  }
  return false
}

async function waitUntilInMeeting(page: Page, timeoutMs = 120_000): Promise<void> {
  const start = Date.now()
  let admittedStreak = 0

  while (Date.now() - start < timeoutMs) {
    const snapshot = await getMeetingAdmissionSnapshot(page)

    if (isBlockedJoinText(snapshot.bodyText)) {
      throw new Error('Blocked from joining — access denied or meeting unavailable')
    }

    const status = inferMeetingAdmissionStatus(snapshot)
    if (status === 'admitted') {
      admittedStreak += 1
      if (admittedStreak >= 2) {
        return
      }
    } else {
      admittedStreak = 0
    }

    if (status === 'ended') {
      throw new Error('Meeting ended or the bot was removed before admission')
    }

    await page.waitForTimeout(2000)
  }
  throw new Error('Timed out waiting to be admitted (2 minutes)')
}

async function captureJoinDebug(
  page: Page,
  sessionId: string,
  suffix: string,
): Promise<{ bodyText: string; screenshotPath: string | undefined }> {
  mkdirSync(DEBUG_DIR, { recursive: true })
  const screenshotPath = join(DEBUG_DIR, `${sessionId}-${suffix}.png`)
  const bodyText = await page
    .evaluate(() => (document.body.innerText || '').slice(0, 1500))
    .catch(() => '')

  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {})

  return {
    bodyText,
    screenshotPath: existsSync(screenshotPath) ? screenshotPath : undefined,
  }
}

async function launchMeetingContext(
  pw: typeof import('playwright-core'),
  hasAuth: boolean,
  headed: boolean,
  usePersistent: boolean,
): Promise<{ context: BrowserContext; page: Page }> {
  const chromiumArgs = [
    '--disable-blink-features=AutomationControlled',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-sync',
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--auto-select-desktop-capture-source=Entire screen',
    '--autoplay-policy=no-user-gesture-required',
    '--disable-dev-shm-usage',
    '--window-size=1280,720',
  ]

  if (!headed) {
    chromiumArgs.push('--headless=new', '--disable-gpu')
  }

  const userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

  let context: BrowserContext
  let page: Page

  if (hasAuth) {
    const browser = await pw.chromium.launch({
      headless: !headed,
      args: chromiumArgs,
      ignoreDefaultArgs: ['--enable-automation'],
    })
    context = await browser.newContext({
      storageState: AUTH_FILE,
      viewport: { width: 1280, height: 720 },
      permissions: ['camera', 'microphone'],
      userAgent,
    })
    page = await context.newPage()
  } else if (usePersistent) {
    context = await pw.chromium.launchPersistentContext(USER_DATA_DIR, {
      headless: !headed,
      args: chromiumArgs,
      ignoreDefaultArgs: ['--enable-automation'],
      viewport: { width: 1280, height: 720 },
      permissions: ['camera', 'microphone'],
      userAgent,
    })
    page = context.pages()[0] ?? (await context.newPage())
  } else {
    const browser = await pw.chromium.launch({
      headless: !headed,
      args: chromiumArgs,
      ignoreDefaultArgs: ['--enable-automation'],
    })
    context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      permissions: ['camera', 'microphone'],
      userAgent,
    })
    page = await context.newPage()
  }

  await context.addInitScript(STEALTH_SCRIPT)
  await context.addInitScript(MEETING_MEDIA_INJECTION_SCRIPT)

  return { context, page }
}

async function closeMeetingContext(context: BrowserContext): Promise<void> {
  const browser = context.browser()
  await context.close().catch(() => {})
  if (browser) {
    await browser.close().catch(() => {})
  }
}

async function enableCaptions(page: Page): Promise<boolean> {
  const clickCaptionsWithDom = async (): Promise<boolean> =>
    page.evaluate(() => {
      const candidates = Array.from(document.querySelectorAll<HTMLElement>('button, [role="button"]'))
      const button = candidates.find((element) => {
        const ariaLabel = element.getAttribute('aria-label') ?? ''
        const text = element.textContent ?? ''
        const icon = element.querySelector('[data-icon]')?.getAttribute('data-icon') ?? ''
        const combined = `${ariaLabel} ${text} ${icon}`.toLowerCase()

        if (combined.includes('turn off captions')) {
          return false
        }

        return (
          combined.includes('turn on captions') ||
          combined.includes('captions (c)') ||
          combined.includes('closed_caption') ||
          combined.includes('captions')
        )
      })

      if (!button) {
        return false
      }

      button.click()
      return true
    }).catch(() => false) as Promise<boolean>

  await page.waitForTimeout(5000)
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('Escape')
    await page.waitForTimeout(200)
  }
  await page.waitForTimeout(500)

  for (const text of ['Got it', 'Dismiss', 'Continue']) {
    try {
      const btn = page.locator(`button:has-text("${text}")`).first()
      if (await btn.isVisible({ timeout: 500 })) {
        await btn.click()
        await page.waitForTimeout(300)
      }
    } catch {}
  }

  const checkCaptions = async (): Promise<boolean> =>
    page.evaluate(() => {
      const allButtons = Array.from(document.querySelectorAll('button'))
      const hasCaptionOff = allButtons.some((btn) => {
        const label = (btn.getAttribute('aria-label') || '').toLowerCase()
        return label.includes('turn off captions')
      })

      return (
        !!document.querySelector('[role="region"][aria-label*="Captions"]') ||
        !!document.querySelector('[aria-label="Captions are on"]') ||
        hasCaptionOff ||
        !!document.querySelector('[data-is-persistent-caption="true"]')
      )
    }).catch(() => false) as Promise<boolean>

  if (await checkCaptions()) return true

  try {
    await page.mouse.move(640, 680)
    await page.waitForTimeout(1000)
    const ccButton = page.locator('button[aria-label*="Turn on captions" i], button[aria-label*="captions" i][aria-pressed="false"]').first()
    if (await ccButton.isVisible({ timeout: 3000 })) {
      await ccButton.click()
      await page.waitForTimeout(2000)
      if (await checkCaptions()) return true
    }
  } catch {}

  if (await clickCaptionsWithDom()) {
    await page.waitForTimeout(2000)
    if (await checkCaptions()) return true
  }

  await page.keyboard.press('c')
  await page.waitForTimeout(2000)
  if (await checkCaptions()) return true

  for (let i = 0; i < 10; i++) {
    await page.keyboard.press('Shift+c')
    await page.waitForTimeout(1000)
    if (await checkCaptions()) return true
  }

  try {
    const moreButton = page
      .locator('button[aria-label*="more options" i], button[aria-label*="More actions" i]')
      .first()
    if (await moreButton.isVisible({ timeout: 2000 })) {
      await moreButton.click()
      await page.waitForTimeout(1000)
      const captionsMenuItem = page
        .locator('li:has-text("Captions"), [role="menuitem"]:has-text("Captions")')
        .first()
      if (await captionsMenuItem.isVisible({ timeout: 2000 })) {
        await captionsMenuItem.click()
        await page.waitForTimeout(2000)
        if (await checkCaptions()) return true
      } else {
        await page.keyboard.press('Escape')
      }
    }
  } catch {}

  try {
    await page.mouse.move(640, 680)
    await page.waitForTimeout(500)
    const ccByIcon = page
      .locator('button:has([data-icon="closed_caption"]), button:has([data-icon="closed_caption_off"])')
      .first()
    if (await ccByIcon.isVisible({ timeout: 2000 })) {
      await ccByIcon.click()
      await page.waitForTimeout(2000)
      if (await checkCaptions()) return true
    }
  } catch {}

  if (await clickCaptionsWithDom()) {
    await page.waitForTimeout(2000)
    if (await checkCaptions()) return true
  }

  return false
}

export async function createMeetingSession(
  input: OpenUtterJoinRequest,
  appConfig: AppConfig,
  onUpdate: (session: ManagedSession) => void,
  onCaption?: (sessionId: string, caption: CaptionEvent) => void,
  sessionId?: string,
): Promise<MeetingRuntimeSession> {
  const id = sessionId ?? randomUUID()
  const noAuth = input.joinMode === 'anon'
  const hasAuth = !noAuth && existsSync(AUTH_FILE)
  let botName = input.botName ?? 'Meetingbot'

  if (!input.botName && existsSync(CONFIG_FILE)) {
    try {
      const cfg = JSON.parse(readFileSync(CONFIG_FILE, 'utf-8')) as { botName?: string }
      if (cfg.botName) botName = cfg.botName
    } catch {}
  }

  mkdirSync(OPENUTTER_DIR, { recursive: true })
  mkdirSync(USER_DATA_DIR, { recursive: true })
  await killOrphanChromeProcesses()

  const session: ManagedSession = {
    id: id,
    provider: 'direct',
    status: 'starting',
    meetingUrl: input.meetingUrl,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    logs: [],
  }
  onUpdate(session)

  const pw = await import('playwright-core')
  let context: BrowserContext | null = null
  let page: Page | null = null

  const updateStatus = (status: ManagedSession['status'], log?: string) => {
    session.status = status
    session.updatedAt = new Date().toISOString()
    if (log) session.logs = [...session.logs.slice(-49), log]
    onUpdate({ ...session })
  }

  if (input.joinMode === 'auth' && !hasAuth) {
    const message = `Authenticated join requested but ${AUTH_FILE} was not found. Run "npx openutter auth" first or use guest mode.`
    updateStatus('failed', message)
    throw new Error(message)
  }

  try {
    const maxJoinRetries = 3
    let joined = false

    for (let attempt = 1; attempt <= maxJoinRetries; attempt += 1) {
      if (context) {
        await closeMeetingContext(context)
      }

      const launched = await launchMeetingContext(
        pw,
        hasAuth,
        input.headed ?? false,
        attempt === 1,
      )
      context = launched.context
      page = launched.page

      updateStatus('joining', `Navigating to ${input.meetingUrl} (attempt ${attempt}/${maxJoinRetries})`)
      await page.goto(input.meetingUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      await page.waitForTimeout(3000)

      await dismissOverlays(page)

      if (!hasAuth) {
        await enterNameIfNeeded(page, botName)
      }

      const bodyText = await page
        .evaluate(() => document.body.innerText || '')
        .catch(() => '')

      if (isBlockedJoinText(bodyText)) {
        const debug = await captureJoinDebug(page, id, `blocked-attempt-${attempt}`)
        session.debugImagePath = debug.screenshotPath
        updateStatus('joining', `Join blocked by Meet${debug.screenshotPath ? ` (${debug.screenshotPath})` : ''}`)

        if (attempt < maxJoinRetries) {
          continue
        }

        throw new Error('Blocked from joining — access denied or meeting unavailable')
      }

      await configureMediaOnPreJoin(page, { cameraEnabled: true, micEnabled: true })
      await page.waitForTimeout(1000)

      updateStatus('joining', 'Clicking join button...')
      joined = await clickJoinButton(page)

      if (!joined) {
        const debug = await captureJoinDebug(page, id, `missing-join-button-${attempt}`)
        session.debugImagePath = debug.screenshotPath
        const snippet = debug.bodyText ? ` Page text: ${debug.bodyText.slice(0, 180)}` : ''
        updateStatus('joining', `Could not find join button.${snippet}`)

        if (attempt < maxJoinRetries) {
          continue
        }

        throw new Error('Could not find join button')
      }

      await page.waitForTimeout(2000)

      try {
        const secondJoin = page.locator('button:has-text("Join now")').first()
        if (await secondJoin.isVisible({ timeout: 2000 })) {
          await secondJoin.click()
        }
      } catch {}

      updateStatus('joining', 'Waiting to be admitted...')

      try {
        await waitUntilInMeeting(page)
        joined = true
        break
      } catch (error) {
        const debug = await captureJoinDebug(page, id, `post-join-${attempt}`)
        session.debugImagePath = debug.screenshotPath
        const message = error instanceof Error ? error.message : String(error)
        updateStatus('joining', `Join attempt ${attempt} failed: ${message}`)

        if (attempt === maxJoinRetries) {
          throw error
        }
      }
    }

    if (!joined || !context || !page) {
      throw new Error('Meeting join did not complete')
    }

    const finalContext = context
    const finalPage = page
    const TURN_GAP_MS = 3000
    const tracking = new Map<string, { rawText: string; sentText: string; ts: number }>()
    const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>()
    let lastCaptionLogAt = 0

    updateStatus('joined', 'Successfully joined meeting')

    await dismissPostJoinDialogs(finalPage)

    const captionsEnabled = await enableCaptions(finalPage)
    if (!captionsEnabled) {
      const debug = await captureJoinDebug(finalPage, id, 'captions-disabled')
      session.debugImagePath = debug.screenshotPath
    }
    updateStatus(
      'joined',
      captionsEnabled
        ? 'Captions enabled'
        : `Could not verify captions — live transcription may not work${session.debugImagePath ? ` (${session.debugImagePath})` : ''}`,
    )

    let captionCallbackCount = 0
    await finalPage.exposeFunction('__meetingbot_onCaption', (speaker: string, text: string) => {
      captionCallbackCount++
      const normalizedSpeaker = normalizeCaptionSpeaker(speaker, botName)
      if (normalizedSpeaker.isSelf) return

      const now = Date.now()
      const key = normalizedSpeaker.speaker
      const prev = tracking.get(key)

      if (prev && now - prev.ts > TURN_GAP_MS) {
        tracking.set(key, { rawText: text, sentText: '', ts: now })
      } else if (prev) {
        prev.rawText = text
        prev.ts = now
      } else {
        tracking.set(key, { rawText: text, sentText: '', ts: now })
      }

      const existingTimer = debounceTimers.get(key)
      if (existingTimer) clearTimeout(existingTimer)

      const debounceMs = getCaptionDebounceMs(text)
      debounceTimers.set(key, setTimeout(() => {
        debounceTimers.delete(key)
        flushCaption(key)
      }, debounceMs))
    })

    function flushCaption(key: string) {
      const entry = tracking.get(key)
      if (!entry || !entry.rawText.trim()) return

      const normRaw = normalizeForCompare(entry.rawText)
      const normSent = normalizeForCompare(entry.sentText)
      let textToSend: string | null = null

      if (!normSent) {
        textToSend = entry.rawText.trim()
      } else if (normRaw.startsWith(normSent) && normSent.length > 0) {
        const diff = entry.rawText.slice(entry.sentText.length).trim()
        if (diff) {
          textToSend = diff
        }
      } else {
        textToSend = entry.rawText.trim()
      }

      if (!textToSend) return

      entry.sentText = entry.rawText

      if (captionCallbackCount <= 10 || captionCallbackCount % 50 === 0) {
        console.log(`[captions] flush "${key}": "${textToSend.substring(0, 100)}${textToSend.length > 100 ? '...' : ''}"`)
      }

      if (Date.now() - lastCaptionLogAt >= 15_000) {
        lastCaptionLogAt = Date.now()
        updateStatus('joined', `Captured caption from ${key}`)
      }

      if (onCaption) {
        onCaption(id, {
          speaker: key,
          text: textToSend,
          timestamp: new Date().toISOString(),
        })
      }
    }

    await finalPage.evaluate(CAPTION_OBSERVER_SCRIPT)
    console.log('[captions] Observer injected and callback registered')

    const captionHealthCheck = setInterval(async () => {
      try {
        const alive = await finalPage.evaluate(() => {
          const obs = (window as any).__meetingbot_captionObserver
          if (!obs) return { alive: false, calls: 0 }
          return { alive: obs.getAlive(), calls: obs.getCallCount() }
        }).catch(() => ({ alive: false, calls: 0 }))

        if (!alive.alive) {
          console.log('[captions] Observer died, re-injecting...')
          await finalPage.evaluate(CAPTION_OBSERVER_SCRIPT)
        }
      } catch (err) {
        console.error('[captions] Health check failed (page may be closed):', err)
        clearInterval(captionHealthCheck)
      }
    }, 10_000)

    const injectAudio = async (wavBase64: string): Promise<void> => {
      await injectSpeech({
        audioBase64: wavBase64,
        visemes: ['sil'],
        vtimes: [0],
        vdurations: [120],
        text: '',
      })
    }

    const injectSpeech = async (payload: Omit<AvatarSpeechEvent, 'sessionId'>): Promise<void> => {
      try {
        await finalPage.evaluate((speechPayload) => {
          (window as any).__meetingbot_injectSpeech(speechPayload)
        }, payload)
      } catch (err) {
        console.error('Speech injection failed:', err)
      }
    }

    const stopAudio = async (): Promise<void> => {
      try {
        await finalPage.evaluate(() => {
          (window as any).__meetingbot_stopAudio?.()
        })
      } catch (err) {
        console.error('Audio stop failed:', err)
      }
    }

    const close = async () => {
      clearInterval(captionHealthCheck)
      for (const timer of debounceTimers.values()) clearTimeout(timer)
      debounceTimers.clear()
      try {
        const leaveBtn = finalPage.locator('[aria-label*="Leave call" i]').first()
        if (await leaveBtn.isVisible({ timeout: 1000 })) {
          await leaveBtn.click()
        }
      } catch {}
      await stopAudio()
      await closeMeetingContext(finalContext)
      updateStatus('stopped', 'Session closed')
    }

    return { session, context: finalContext, page: finalPage, injectAudio, injectSpeech, stopAudio, close }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    updateStatus('failed', `Join failed: ${msg}`)
    if (context) {
      await closeMeetingContext(context)
    }
    throw err
  }
}
