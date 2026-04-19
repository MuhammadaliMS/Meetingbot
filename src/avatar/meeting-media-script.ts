/**
 * Browser init script that injects synthetic microphone and camera streams
 * backed by a lightweight canvas avatar and queued bot speech.
 */
export const MEETING_MEDIA_INJECTION_SCRIPT = String.raw`
(function() {
  var MOUTH_SHAPES = {
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
    U: { openY: 0.4, widthX: 0.6, roundX: 0.9 }
  };

  window.__meetingbot_audioQueue = [];
  window.__meetingbot_playing = false;
  window.__meetingbot_audioCtx = null;
  window.__meetingbot_audioDest = null;
  window.__meetingbot_currentSource = null;
  window.__meetingbot_avatarCanvas = null;
  window.__meetingbot_avatarCtx = null;
  window.__meetingbot_avatarStream = null;
  window.__meetingbot_avatarTrack = null;
  window.__meetingbot_avatarLoopHandle = null;
  window.__meetingbot_visemeTimeouts = [];
  window.__meetingbot_avatarState = {
    currentMouth: { openY: 0, widthX: 1, roundX: 0 },
    targetMouth: { openY: 0, widthX: 1, roundX: 0 },
    isSpeaking: false,
    blinkTimer: 0,
    blinkState: 0,
    breathPhase: 0
  };

  function cloneShape(shape) {
    return {
      openY: shape.openY,
      widthX: shape.widthX,
      roundX: shape.roundX
    };
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function attachCanvas(canvas) {
    var parent = document.body || document.documentElement;
    if (!parent || canvas.__meetingbotAttached) return;
    canvas.__meetingbotAttached = true;
    parent.appendChild(canvas);
  }

  function ensureAvatarCanvas() {
    if (window.__meetingbot_avatarCanvas && window.__meetingbot_avatarTrack) {
      return window.__meetingbot_avatarCanvas;
    }

    var canvas = document.createElement('canvas');
    canvas.width = 720;
    canvas.height = 720;
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.position = 'fixed';
    canvas.style.right = '16px';
    canvas.style.bottom = '16px';
    canvas.style.width = '120px';
    canvas.style.height = '120px';
    canvas.style.opacity = '0.01';
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = '-1';
    window.__meetingbot_avatarCanvas = canvas;
    window.__meetingbot_avatarCtx = canvas.getContext('2d');

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function onReady() {
        document.removeEventListener('DOMContentLoaded', onReady);
        attachCanvas(canvas);
      });
    } else {
      attachCanvas(canvas);
    }

    window.__meetingbot_avatarStream = canvas.captureStream(24);
    window.__meetingbot_avatarTrack = window.__meetingbot_avatarStream.getVideoTracks()[0] || null;
    if (window.__meetingbot_avatarTrack && 'contentHint' in window.__meetingbot_avatarTrack) {
      try { window.__meetingbot_avatarTrack.contentHint = 'motion'; } catch (e) {}
    }

    startAvatarLoop();
    return canvas;
  }

  function drawAvatar() {
    var canvas = ensureAvatarCanvas();
    var ctx = window.__meetingbot_avatarCtx;
    if (!canvas || !ctx) return;

    var state = window.__meetingbot_avatarState;
    var w = canvas.width;
    var h = canvas.height;
    var cx = w / 2;
    var cy = h / 2;

    state.currentMouth.openY = lerp(state.currentMouth.openY, state.targetMouth.openY, 0.28);
    state.currentMouth.widthX = lerp(state.currentMouth.widthX, state.targetMouth.widthX, 0.28);
    state.currentMouth.roundX = lerp(state.currentMouth.roundX, state.targetMouth.roundX, 0.28);

    state.breathPhase += 0.025;
    var breathOffset = Math.sin(state.breathPhase) * 4;
    var headY = cy + breathOffset - 28;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = '#1b2433';
    ctx.beginPath();
    ctx.arc(cx, cy, 250, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#f4c7a3';
    ctx.fillRect(cx - 52, headY + 208, 104, 72);

    ctx.fillStyle = '#2d5a87';
    ctx.beginPath();
    ctx.moveTo(cx - 220, h);
    ctx.lineTo(cx - 132, headY + 252);
    ctx.lineTo(cx + 132, headY + 252);
    ctx.lineTo(cx + 220, h);
    ctx.fill();

    ctx.strokeStyle = '#1e3a5f';
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(cx - 72, headY + 252);
    ctx.lineTo(cx, headY + 286);
    ctx.lineTo(cx + 72, headY + 252);
    ctx.stroke();

    ctx.fillStyle = '#f4c7a3';
    ctx.beginPath();
    ctx.ellipse(cx, headY, 168, 196, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#2d1810';
    ctx.beginPath();
    ctx.ellipse(cx, headY - 112, 176, 118, 0, Math.PI, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(cx - 170, headY - 28);
    ctx.quadraticCurveTo(cx - 186, headY - 94, cx - 154, headY - 112);
    ctx.lineTo(cx - 170, headY - 28);
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(cx + 170, headY - 28);
    ctx.quadraticCurveTo(cx + 186, headY - 94, cx + 154, headY - 112);
    ctx.lineTo(cx + 170, headY - 28);
    ctx.fill();

    ctx.fillStyle = '#f4c7a3';
    ctx.beginPath();
    ctx.ellipse(cx - 164, headY - 8, 22, 34, -0.15, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(cx + 164, headY - 8, 22, 34, 0.15, 0, Math.PI * 2);
    ctx.fill();

    state.blinkTimer += 1;
    if (state.blinkTimer > 180 + Math.random() * 120) {
      state.blinkState = 1;
      state.blinkTimer = 0;
    }
    if (state.blinkState > 0) state.blinkState += 0.15;
    if (state.blinkState > 1) state.blinkState = 0;

    var eyeOpenness = state.blinkState > 0 ? Math.max(0.1, 1 - Math.sin(state.blinkState * Math.PI)) : 1;
    var eyeY = headY - 42;
    var leftEyeX = cx - 58;
    var rightEyeX = cx + 58;

    [leftEyeX, rightEyeX].forEach(function(ex) {
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.ellipse(ex, eyeY, 28, 20 * eyeOpenness, 0, 0, Math.PI * 2);
      ctx.fill();

      if (eyeOpenness > 0.3) {
        ctx.fillStyle = '#1a1a2e';
        ctx.beginPath();
        ctx.ellipse(ex + 2, eyeY + 2, 12, 12, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.ellipse(ex + 6, eyeY - 4, 4, 4, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    });

    ctx.strokeStyle = '#2d1810';
    ctx.lineWidth = 8;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(leftEyeX - 28, headY - 86);
    ctx.quadraticCurveTo(leftEyeX, headY - 94 - (state.isSpeaking ? 6 : 0), leftEyeX + 28, headY - 86);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(rightEyeX - 28, headY - 86);
    ctx.quadraticCurveTo(rightEyeX, headY - 94 - (state.isSpeaking ? 6 : 0), rightEyeX + 28, headY - 86);
    ctx.stroke();

    ctx.strokeStyle = '#e8b08a';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(cx, headY - 10);
    ctx.quadraticCurveTo(cx + 18, headY + 34, cx, headY + 40);
    ctx.stroke();

    var mouthY = headY + 82;
    var mouthW = 76 * state.currentMouth.widthX;
    var mouthH = 18 + state.currentMouth.openY * 80;
    if (state.currentMouth.openY > 0.08) {
      ctx.fillStyle = '#3d0c0c';
      ctx.beginPath();
      ctx.ellipse(cx, mouthY, Math.max(10, mouthW / 2), Math.max(8, mouthH / 2), 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#f0f0f0';
      ctx.beginPath();
      ctx.ellipse(cx, mouthY - mouthH * 0.16, Math.max(8, mouthW * 0.36), Math.max(4, mouthH * 0.16), 0, Math.PI, Math.PI * 2);
      ctx.fill();

      if (state.currentMouth.openY > 0.3) {
        ctx.fillStyle = '#c45050';
        ctx.beginPath();
        ctx.ellipse(cx, mouthY + mouthH * 0.12, Math.max(8, mouthW * 0.22), Math.max(4, mouthH * 0.16), 0, 0, Math.PI);
        ctx.fill();
      }

      ctx.strokeStyle = '#d4736a';
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.ellipse(cx, mouthY, Math.max(10, mouthW / 2), Math.max(8, mouthH / 2), 0, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.strokeStyle = '#d4736a';
      ctx.lineWidth = 8;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cx - mouthW / 2, mouthY);
      ctx.quadraticCurveTo(cx, mouthY + 16, cx + mouthW / 2, mouthY);
      ctx.stroke();
    }

    if (state.isSpeaking) {
      ctx.fillStyle = 'rgba(220, 130, 130, 0.15)';
      ctx.beginPath();
      ctx.ellipse(cx - 110, headY + 36, 36, 20, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(cx + 110, headY + 36, 36, 20, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function startAvatarLoop() {
    if (window.__meetingbot_avatarLoopHandle) return;
    var loop = function() {
      drawAvatar();
      window.__meetingbot_avatarLoopHandle = window.requestAnimationFrame(loop);
    };
    loop();
  }

  function setViseme(viseme) {
    var shape = MOUTH_SHAPES[viseme] || MOUTH_SHAPES.sil;
    window.__meetingbot_avatarState.targetMouth = cloneShape(shape);
    window.__meetingbot_avatarState.isSpeaking = viseme !== 'sil';
  }

  function resetAvatar() {
    window.__meetingbot_avatarState.targetMouth = cloneShape(MOUTH_SHAPES.sil);
    window.__meetingbot_avatarState.isSpeaking = false;
  }

  function clearVisemeSchedule() {
    for (var index = 0; index < window.__meetingbot_visemeTimeouts.length; index += 1) {
      clearTimeout(window.__meetingbot_visemeTimeouts[index]);
    }
    window.__meetingbot_visemeTimeouts = [];
  }

  function scheduleVisemes(visemes, vtimes, vdurations) {
    clearVisemeSchedule();

    if (!Array.isArray(visemes) || visemes.length === 0) {
      resetAvatar();
      return;
    }

    var lastEnd = 0;
    for (var index = 0; index < visemes.length; index += 1) {
      (function(viseme, atMs, durationMs) {
        window.__meetingbot_visemeTimeouts.push(setTimeout(function() {
          setViseme(viseme);
        }, Math.max(0, atMs || 0)));
        lastEnd = Math.max(lastEnd, Math.max(0, atMs || 0) + Math.max(0, durationMs || 120));
      })(visemes[index], vtimes[index], vdurations[index]);
    }

    window.__meetingbot_visemeTimeouts.push(setTimeout(function() {
      resetAvatar();
    }, lastEnd + 140));
  }

  window.__meetingbot_ensureAudio = async function() {
    if (!window.__meetingbot_audioCtx) {
      window.__meetingbot_audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      window.__meetingbot_audioDest = window.__meetingbot_audioCtx.createMediaStreamDestination();
    }

    if (window.__meetingbot_audioCtx.state === 'suspended') {
      try { await window.__meetingbot_audioCtx.resume(); } catch (e) {}
    }

    return window.__meetingbot_audioCtx;
  };

  window.__meetingbot_ensureVideoTrack = async function() {
    ensureAvatarCanvas();
    return window.__meetingbot_avatarTrack;
  };

  var originalGetUserMedia = navigator.mediaDevices && navigator.mediaDevices.getUserMedia
    ? navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
    : null;

  if (originalGetUserMedia) {
    navigator.mediaDevices.getUserMedia = async function(constraints) {
      var wantsAudio = !!(constraints && constraints.audio);
      var wantsVideo = !!(constraints && constraints.video);
      if (!wantsAudio && !wantsVideo) {
        return originalGetUserMedia(constraints);
      }

      var stream = new MediaStream();

      if (wantsVideo) {
        var videoTrack = await window.__meetingbot_ensureVideoTrack();
        if (videoTrack) {
          stream.addTrack(videoTrack.clone ? videoTrack.clone() : videoTrack);
        }
      }

      if (wantsAudio) {
        await window.__meetingbot_ensureAudio();
        var audioTrack = window.__meetingbot_audioDest && window.__meetingbot_audioDest.stream
          ? window.__meetingbot_audioDest.stream.getAudioTracks()[0]
          : null;
        if (audioTrack) {
          stream.addTrack(audioTrack.clone ? audioTrack.clone() : audioTrack);
        }
      }

      if (stream.getTracks().length > 0) {
        return stream;
      }

      return originalGetUserMedia(constraints);
    };
  }

  window.__meetingbot_playNext = async function() {
    if (window.__meetingbot_playing || window.__meetingbot_audioQueue.length === 0) return;
    window.__meetingbot_playing = true;

    var payload = window.__meetingbot_audioQueue.shift();
    try {
      await window.__meetingbot_ensureAudio();
      ensureAvatarCanvas();
      scheduleVisemes(payload.visemes || [], payload.vtimes || [], payload.vdurations || []);

      var binary = atob(payload.audioBase64);
      var bytes = new Uint8Array(binary.length);
      for (var index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }

      var audioBuffer = await window.__meetingbot_audioCtx.decodeAudioData(bytes.buffer.slice(0));
      var source = window.__meetingbot_audioCtx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(window.__meetingbot_audioDest);
      window.__meetingbot_currentSource = source;

      await new Promise(function(resolve) {
        source.onended = resolve;
        source.start();
      });
    } catch (e) {
      console.error('[Meetingbot] Speech injection failed:', e);
      resetAvatar();
    }

    window.__meetingbot_currentSource = null;
    window.__meetingbot_playing = false;
    if (window.__meetingbot_audioQueue.length === 0) {
      resetAvatar();
    }
    window.__meetingbot_playNext();
  };

  window.__meetingbot_injectSpeech = function(payload) {
    if (!payload || !payload.audioBase64) return;
    window.__meetingbot_audioQueue.push(payload);
    window.__meetingbot_playNext();
  };

  window.__meetingbot_injectAudio = function(wavBase64) {
    window.__meetingbot_injectSpeech({
      audioBase64: wavBase64,
      visemes: ['sil'],
      vtimes: [0],
      vdurations: [120]
    });
  };

  window.__meetingbot_stopAudio = function() {
    window.__meetingbot_audioQueue = [];
    clearVisemeSchedule();
    resetAvatar();

    if (window.__meetingbot_currentSource) {
      try { window.__meetingbot_currentSource.stop(); } catch (e) {}
      try { window.__meetingbot_currentSource.disconnect(); } catch (e) {}
      window.__meetingbot_currentSource = null;
    }

    window.__meetingbot_playing = false;
  };

  window.__meetingbot_getInjectedStream = function() {
    ensureAvatarCanvas();
    return {
      audio: window.__meetingbot_audioDest ? window.__meetingbot_audioDest.stream : null,
      video: window.__meetingbot_avatarStream
    };
  };

  ensureAvatarCanvas();
})();
`
