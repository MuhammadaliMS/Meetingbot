const canvas = document.getElementById('avatarCanvas')
const ctx = canvas.getContext('2d')

const dpr = window.devicePixelRatio || 1
const displayWidth = 300
const displayHeight = 300
canvas.width = displayWidth * dpr
canvas.height = displayHeight * dpr
canvas.style.width = displayWidth + 'px'
canvas.style.height = displayHeight + 'px'
ctx.scale(dpr, dpr)

const WS_URL = `ws://${window.location.host}/ws/avatar`

const VISEME_MOUTH_SHAPES = {
  sil: { openY: 0, widthX: 1, roundX: 0 },
  PP: { openY: 0.05, widthX: 0.85, roundX: 0 },
  FF: { openY: 0.15, widthX: 0.9, roundX: 0 },
  TH: { openY: 0.2, widthX: 0.95, roundX: 0.1 },
  DD: { openY: 0.25, widthX: 1, roundX: 0 },
  kk: { openY: 0.3, widthX: 1, roundX: 0 },
  nn: { openY: 0.2, widthX: 0.9, roundX: 0.1 },
  SS: { openY: 0.15, widthX: 1.1, roundX: 0 },
  CH: { openY: 0.25, widthX: 1, roundX: 0.15 },
  RR: { openY: 0.3, widthX: 0.8, roundX: 0.5 },
  aa: { openY: 0.7, widthX: 1.1, roundX: 0.2 },
  E: { openY: 0.45, widthX: 1.3, roundX: 0 },
  I: { openY: 0.4, widthX: 1.2, roundX: 0 },
  O: { openY: 0.55, widthX: 0.8, roundX: 0.7 },
  U: { openY: 0.4, widthX: 0.6, roundX: 0.9 },
}

const MOUTH_BASE_WIDTH = 32
const MOUTH_BASE_HEIGHT = 10

let currentMouth = { openY: 0, widthX: 1, roundX: 0 }
let targetMouth = { openY: 0, widthX: 1, roundX: 0 }
let blinkTimer = 0
let blinkState = 0
let breathPhase = 0
let isSpeaking = false
let speakingTimeout = null
let visemeTimeouts = []

let ws = null
let currentAudio = null
let audioQueue = []
let isPlayingAudio = false
let currentSessionId = null

function lerp(a, b, t) {
  return a + (b - a) * t
}

function drawAvatar() {
  const w = displayWidth
  const h = displayHeight
  const cx = w / 2
  const cy = h / 2

  ctx.clearRect(0, 0, w, h)

  currentMouth.openY = lerp(currentMouth.openY, targetMouth.openY, 0.3)
  currentMouth.widthX = lerp(currentMouth.widthX, targetMouth.widthX, 0.3)
  currentMouth.roundX = lerp(currentMouth.roundX, targetMouth.roundX, 0.3)

  breathPhase += 0.02
  const breathOffset = Math.sin(breathPhase) * 2

  const headY = cy + breathOffset - 10

  const faceColor = '#f4c7a3'
  const hairColor = '#2d1810'
  const eyeWhite = '#ffffff'
  const pupilColor = '#1a1a2e'
  const lipColor = '#d4736a'
  const noseColor = '#e8b08a'
  const bgColor = '#0d1117'

  ctx.fillStyle = bgColor
  ctx.fillRect(0, 0, w, h)

  // Neck
  ctx.fillStyle = faceColor
  ctx.fillRect(cx - 25, headY + 70, 50, 40)

  // Shoulders / shirt
  ctx.fillStyle = '#2d5a87'
  ctx.beginPath()
  ctx.moveTo(cx - 100, h)
  ctx.lineTo(cx - 60, headY + 95)
  ctx.lineTo(cx + 60, headY + 95)
  ctx.lineTo(cx + 100, h)
  ctx.fill()

  // Collar
  ctx.strokeStyle = '#1e3a5f'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(cx - 30, headY + 95)
  ctx.lineTo(cx, headY + 110)
  ctx.lineTo(cx + 30, headY + 95)
  ctx.stroke()

  // Face
  ctx.fillStyle = faceColor
  ctx.beginPath()
  ctx.ellipse(cx, headY, 80, 95, 0, 0, Math.PI * 2)
  ctx.fill()

  // Hair
  ctx.fillStyle = hairColor
  ctx.beginPath()
  ctx.ellipse(cx, headY - 55, 85, 55, 0, Math.PI, Math.PI * 2)
  ctx.fill()

  ctx.beginPath()
  ctx.moveTo(cx - 82, headY - 20)
  ctx.quadraticCurveTo(cx - 88, headY - 50, cx - 75, headY - 55)
  ctx.lineTo(cx - 82, headY - 20)
  ctx.fill()

  ctx.beginPath()
  ctx.moveTo(cx + 82, headY - 20)
  ctx.quadraticCurveTo(cx + 88, headY - 50, cx + 75, headY - 55)
  ctx.lineTo(cx + 82, headY - 20)
  ctx.fill()

  // Ears
  ctx.fillStyle = faceColor
  ctx.beginPath()
  ctx.ellipse(cx - 78, headY - 5, 10, 16, -0.15, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.ellipse(cx + 78, headY - 5, 10, 16, 0.15, 0, Math.PI * 2)
  ctx.fill()

  // Eyes
  blinkTimer++
  if (blinkTimer > 180 + Math.random() * 120) {
    blinkState = 1
    blinkTimer = 0
  }
  if (blinkState > 0) blinkState += 0.15
  if (blinkState > 1) blinkState = 0

  const eyeOpenness = blinkState > 0 ? Math.max(0.1, 1 - Math.sin(blinkState * Math.PI)) : 1
  const eyeY = headY - 20
  const leftEyeX = cx - 28
  const rightEyeX = cx + 28

  for (const ex of [leftEyeX, rightEyeX]) {
    // White
    ctx.fillStyle = eyeWhite
    ctx.beginPath()
    ctx.ellipse(ex, eyeY, 14, 10 * eyeOpenness, 0, 0, Math.PI * 2)
    ctx.fill()

    // Pupil
    if (eyeOpenness > 0.3) {
      ctx.fillStyle = pupilColor
      ctx.beginPath()
      ctx.ellipse(ex + 1, eyeY + 1, 6, 6, 0, 0, Math.PI * 2)
      ctx.fill()

      // Highlight
      ctx.fillStyle = '#ffffff'
      ctx.beginPath()
      ctx.ellipse(ex + 3, eyeY - 2, 2, 2, 0, 0, Math.PI * 2)
      ctx.fill()
    }

    // Eyelid
    ctx.fillStyle = faceColor
    if (eyeOpenness < 0.95) {
      ctx.beginPath()
      ctx.ellipse(ex, eyeY - 10 * eyeOpenness, 16, 12 * (1 - eyeOpenness), 0, 0, Math.PI)
      ctx.fill()
    }
  }

  // Eyebrows
  ctx.strokeStyle = hairColor
  ctx.lineWidth = 3
  ctx.lineCap = 'round'

  ctx.beginPath()
  ctx.moveTo(leftEyeX - 14, headY - 38 + (isSpeaking ? -1 : 0))
  ctx.quadraticCurveTo(leftEyeX, headY - 42 + (isSpeaking ? -2 : 0), leftEyeX + 14, headY - 38)
  ctx.stroke()

  ctx.beginPath()
  ctx.moveTo(rightEyeX - 14, headY - 38 + (isSpeaking ? -1 : 0))
  ctx.quadraticCurveTo(rightEyeX, headY - 42 + (isSpeaking ? -2 : 0), rightEyeX + 14, headY - 38)
  ctx.stroke()

  // Nose
  ctx.strokeStyle = noseColor
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(cx, headY - 5)
  ctx.quadraticCurveTo(cx + 8, headY + 15, cx, headY + 18)
  ctx.stroke()

  // Mouth
  const mouthY = headY + 38
  const mouthW = MOUTH_BASE_WIDTH * currentMouth.widthX
  const mouthH = MOUTH_BASE_HEIGHT + currentMouth.openY * 30
  const roundness = currentMouth.roundX

  if (currentMouth.openY > 0.08) {
    // Open mouth
    const rx = Math.max(1, mouthW / 2)
    const ry = Math.max(1, mouthH / 2)

    ctx.fillStyle = '#3d0c0c'
    ctx.beginPath()
    ctx.ellipse(cx, mouthY, rx, ry, 0, 0, Math.PI * 2)
    ctx.fill()

    // Teeth
    ctx.fillStyle = '#f0f0f0'
    ctx.beginPath()
    ctx.ellipse(cx, mouthY - ry * 0.3, rx * 0.8, ry * 0.3, 0, Math.PI, Math.PI * 2)
    ctx.fill()

    // Tongue
    if (currentMouth.openY > 0.3) {
      ctx.fillStyle = '#c45050'
      ctx.beginPath()
      ctx.ellipse(cx, mouthY + ry * 0.3, rx * 0.5, ry * 0.3, 0, 0, Math.PI)
      ctx.fill()
    }

    // Lips outline
    ctx.strokeStyle = lipColor
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.ellipse(cx, mouthY, rx, ry, 0, 0, Math.PI * 2)
    ctx.stroke()
  } else {
    // Closed / smile mouth
    ctx.strokeStyle = lipColor
    ctx.lineWidth = 3
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(cx - mouthW / 2, mouthY)
    ctx.quadraticCurveTo(cx, mouthY + 6, cx + mouthW / 2, mouthY)
    ctx.stroke()
  }

  // Cheek blush when speaking
  if (isSpeaking) {
    ctx.fillStyle = 'rgba(220, 130, 130, 0.15)'
    ctx.beginPath()
    ctx.ellipse(cx - 50, headY + 15, 18, 10, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.beginPath()
    ctx.ellipse(cx + 50, headY + 15, 18, 10, 0, 0, Math.PI * 2)
    ctx.fill()
  }

  requestAnimationFrame(drawAvatar)
}

function setViseme(viseme) {
  const shape = VISEME_MOUTH_SHAPES[viseme] || VISEME_MOUTH_SHAPES.sil
  targetMouth = { ...shape }
  isSpeaking = viseme !== 'sil'

  document.getElementById('avatarStatus').textContent = isSpeaking ? 'speaking' : 'idle'
  document.getElementById('avatarStatus').className = 'avatar-status' + (isSpeaking ? ' speaking' : '')

  if (speakingTimeout) clearTimeout(speakingTimeout)
  speakingTimeout = setTimeout(() => {
    targetMouth = { ...VISEME_MOUTH_SHAPES.sil }
    isSpeaking = false
    document.getElementById('avatarStatus').textContent = 'idle'
    document.getElementById('avatarStatus').className = 'avatar-status'
  }, 300)
}

function resetAvatarToIdle() {
  if (speakingTimeout) {
    clearTimeout(speakingTimeout)
    speakingTimeout = null
  }

  targetMouth = { ...VISEME_MOUTH_SHAPES.sil }
  isSpeaking = false
  document.getElementById('avatarStatus').textContent = 'idle'
  document.getElementById('avatarStatus').className = 'avatar-status'
}

function clearVisemeSchedule() {
  for (const timeoutId of visemeTimeouts) {
    clearTimeout(timeoutId)
  }
  visemeTimeouts = []
}

function playVisemes(visemes, vtimes, vdurations) {
  if (!isPlayingAudio && audioQueue.length === 0) {
    clearVisemeSchedule()
  }

  for (let i = 0; i < visemes.length; i++) {
    const delay = vtimes[i]
    const viseme = visemes[i]

    const timeoutId = setTimeout(() => {
      setViseme(viseme)
    }, delay)
    visemeTimeouts.push(timeoutId)
  }
}

function playAudio(base64Wav) {
  audioQueue.push(base64Wav)
  if (!isPlayingAudio) {
    playNextInQueue()
  }
}

function playNextInQueue() {
  if (audioQueue.length === 0) {
    isPlayingAudio = false
    return
  }

  isPlayingAudio = true
  const base64Wav = audioQueue.shift()

  const binary = atob(base64Wav)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }

  const blob = new Blob([bytes], { type: 'audio/wav' })
  const url = URL.createObjectURL(blob)

  currentAudio = new Audio(url)
  currentAudio.play().catch(() => {})
  currentAudio.onended = () => {
    URL.revokeObjectURL(url)
    currentAudio = null
    playNextInQueue()
  }
}

function flushAudioQueue() {
  audioQueue = []
  isPlayingAudio = false
}

function stopPlayback() {
  clearVisemeSchedule()
  flushAudioQueue()
  resetAvatarToIdle()

  if (currentAudio) {
    currentAudio.pause()
    currentAudio.currentTime = 0
    currentAudio = null
  }
}

function addChatMessage(text, role) {
  const container = document.getElementById('chatMessages')
  const emptyMsg = container.querySelector('.empty')
  if (emptyMsg) emptyMsg.remove()

  const div = document.createElement('div')
  div.className = `chat-msg ${role}`
  div.innerHTML = `<div class="label">${role === 'user' ? 'You' : 'Agent'}</div>${text}`
  container.appendChild(div)
  container.scrollTop = container.scrollHeight
}

function addCaption(speaker, text) {
  const container = document.getElementById('captionsList')
  const emptyMsg = container.querySelector('.empty')
  if (emptyMsg) emptyMsg.remove()

  const lastItem = container.lastElementChild
  if (lastItem && lastItem.querySelector('.speaker')?.textContent === speaker + ':') {
    lastItem.querySelector('.caption-text').textContent = text
    return
  }

  const div = document.createElement('div')
  div.className = 'caption-item'
  div.innerHTML = `<span class="speaker">${speaker}:</span><span class="caption-text">${text}</span>`
  container.appendChild(div)
  container.scrollTop = container.scrollHeight
}

function updateSessions(sessions) {
  const container = document.getElementById('sessionsList')
  const emptyMsg = container.querySelector('.empty')

  if (!sessions || sessions.length === 0) {
    currentSessionId = null
    container.innerHTML = '<p class="empty">No active sessions</p>'
    return
  }

  const activeSession = sessions.find((session) => session.id === currentSessionId)
  if (!activeSession || activeSession.status === 'failed' || activeSession.status === 'stopped' || activeSession.status === 'ended') {
    const preferredSession = sessions.find((session) => session.status === 'joined')
      ?? sessions[0]
    currentSessionId = preferredSession?.id ?? null
  }

  container.innerHTML = sessions.map(s => `
    <div class="session-item">
      <span class="url">${s.meetingUrl}</span>
      <span class="badge ${s.status}">${s.status}</span>
    </div>
  `).join('')
}

function connectWebSocket() {
  const statusEl = document.getElementById('wsStatus')

  ws = new WebSocket(WS_URL)

  ws.onopen = () => {
    statusEl.textContent = 'connected'
    statusEl.className = 'status connected'
    if (currentSessionId) {
      ws.send(JSON.stringify({ type: 'bind_session', sessionId: currentSessionId }))
    }
    loadSessions()
  }

  ws.onclose = () => {
    statusEl.textContent = 'disconnected'
    statusEl.className = 'status error'
    setTimeout(connectWebSocket, 3000)
  }

  ws.onerror = () => {
    statusEl.textContent = 'error'
    statusEl.className = 'status error'
  }

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data)

    if (msg.type === 'connected') {
      console.log('Avatar bridge connected:', msg.clientId)
    }

    if (msg.type === 'avatar_speak') {
      playVisemes(msg.visemes, msg.vtimes, msg.vdurations)
      playAudio(msg.audioBase64)
      if (msg.text) {
        addChatMessage(msg.text, 'agent')
      }
    }

    if (msg.type === 'avatar_stop') {
      stopPlayback()
    }

    if (msg.type === 'caption') {
      addCaption(msg.speaker, msg.text)
    }

    if (msg.type === 'session_update') {
      loadSessions()
    }
  }
}

async function loadSessions() {
  try {
    const res = await fetch('/sessions')
    const sessions = await res.json()
    updateSessions(sessions)
  } catch {}
}

document.getElementById('joinForm').addEventListener('submit', async (e) => {
  e.preventDefault()
  const url = document.getElementById('meetingUrl').value
  const mode = document.getElementById('joinMode').value
  const name = document.getElementById('botName').value
  const provider = document.getElementById('provider').value
  const btn = document.getElementById('joinBtn')

  btn.disabled = true
  btn.textContent = 'Joining...'

  try {
    const res = await fetch('/sessions/openutter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        meetingUrl: url,
        joinMode: mode,
        botName: name || 'Meetingbot',
        provider: provider,
      }),
    })

    const session = await res.json()
    if (!res.ok) {
      throw new Error(session.error || 'Join request failed')
    }

    if (ws && ws.readyState === ws.OPEN) {
      currentSessionId = session.id
      ws.send(JSON.stringify({ type: 'bind_session', sessionId: session.id }))
    }

    addChatMessage(`Started joining meeting: ${url}`, 'user')
    loadSessions()
  } catch (err) {
    addChatMessage(`Failed to join: ${err.message}`, 'user')
  } finally {
    btn.disabled = false
    btn.textContent = 'Join Meeting'
  }
})

document.getElementById('chatForm').addEventListener('submit', async (e) => {
  e.preventDefault()
  const input = document.getElementById('chatInput')
  const text = input.value.trim()
  if (!text) return

  input.value = ''
  addChatMessage(text, 'user')

  try {
    const res = await fetch('/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: text,
        sessionId: currentSessionId ?? undefined,
      }),
    })
    const data = await res.json()

    if (data.error) {
      addChatMessage(`Error: ${data.error}`, 'agent')
    }
  } catch (err) {
    addChatMessage(`Error: ${err.message}`, 'agent')
  }
})

connectWebSocket()
drawAvatar()
loadSessions()
