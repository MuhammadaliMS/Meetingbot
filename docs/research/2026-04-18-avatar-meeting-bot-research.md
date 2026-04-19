# Avatar Meeting Bot Research

Date: 2026-04-18

## Executive Summary

You asked for the end product, not a pile of options: an AI that joins meetings as an avatar with a face and talks to people.

The cleanest architecture is:

1. Use a browser automation joiner for Google Meet.
2. Run the conversational agent and TTS separately from the joiner.
3. Render the avatar in its own worker.
4. Publish the avatar into the meeting through a virtual camera and virtual microphone, or through a media room such as LiveKit if the avatar provider already supports it.

For the actual face:

- Fastest demo: `Pika`.
- Best self-hosted near-production path: `bitHuman + LiveKit`.
- Most open-source control: `MuseTalk + LivePortrait + v4l2loopback`.

## What the referenced repos give us

### 1. `AgentZero`

Repo: [MuhammadaliMS/AgentZero](https://github.com/MuhammadaliMS/AgentZero)

Relevant findings:

- The repo already treats the meeting bot as a separate long-running container service.
- The `bot-service` Docker setup installs Chromium, PulseAudio, ffmpeg, Python, and Xvfb.
- The bot scheduler polls upcoming meetings, joins them, records audio/video, then triggers transcription and downstream processing.
- The schema migration `022_meeting_bot.sql` shows the product model you likely want around recordings, transcript segments, summaries, action items, and decisions.

What this means:

- `AgentZero` is the right reference for operational shape: container, scheduler, webhook flow, storage model.
- It is not the right reference for the avatar tile itself. Its current bot is a recorder/transcriber, not a talking face.

### 2. `openutter`

Repo: [sumansid/openutter](https://github.com/sumansid/openutter)

Relevant findings:

- It is a headless Google Meet bot built on Playwright.
- It supports guest joins and authenticated joins.
- It enables live captions and writes transcripts to disk.
- It takes screenshots and exposes clear lifecycle markers such as transcript path and success/failure states.

What this means:

- `openutter` is the strongest starting point for the Google Meet join problem.
- It currently behaves as an observer bot. It does not solve avatar video publishing, voice playback, or agent speech.

### 3. `Pika-Skills`

Repo: [Pika-Labs/Pika-Skills](https://github.com/Pika-Labs/Pika-Skills)

Relevant findings:

- `pikastream-video-meeting` is the closest match to your target UX.
- The skill can generate an avatar image, clone a voice, and join a meeting as a real-time avatar.
- The Python script hits a hosted Pika API endpoint to create a meeting session and waits until the video worker and meeting bot are connected.

What this means:

- Pika proves the product pattern.
- It is the fastest way to demo the experience.
- It is not the most self-hosted or open stack.

## Current platform facts that matter

### Meeting bots

Recall’s January 22, 2026 write-up is a good framing document for the form factor:

- a meeting bot joins as a participant
- can capture audio, video, chat, captions, metadata
- can also output audio, video, chat, and screenshare back into the meeting
- Google Meet typically requires browser automation because there is no dedicated bot API

Source: [Recall.ai: What is a meeting bot?](https://www.recall.ai/blog/what-is-a-meeting-bot)

This matters because your avatar bot is not just a note taker. It needs the outbound part too: audio + video back into the call.

## Avatar architecture options

### Option A: Pika hosted avatar

Best for:

- fastest demo
- lowest engineering effort
- immediate "AI joins the meeting with a face" milestone

Why:

- already implements the full product behavior you want
- includes voice cloning and avatar generation flow
- externalizes the hard real-time video problem

Tradeoffs:

- hosted dependency
- usage-based billing
- less control over internals

Source:

- [Pika Skills README](https://github.com/Pika-Labs/Pika-Skills)

### Option B: bitHuman self-hosted GPU container + LiveKit

Best for:

- self-hosted production path
- lower integration risk than fully open-source neural-avatar plumbing
- teams okay with a proprietary model/container but wanting infra control

Why:

- bitHuman documents a self-hosted GPU worker that joins a LiveKit room and publishes lip-synced video in real time
- LiveKit documents the exact avatar-worker model: a secondary participant publishes synchronized audio and video on behalf of the agent

Tradeoffs:

- still a vendor dependency
- requires GPU
- requires LiveKit room orchestration

Sources:

- [bitHuman self-hosted GPU container](https://docs.bithuman.ai/deployment/self-hosted-gpu)
- [LiveKit virtual avatars](https://docs.livekit.io/agents/models/avatar/)

### Option C: MuseTalk + LivePortrait + virtual camera

Best for:

- maximum control
- open-source-first build
- custom face motion pipeline

Why:

- MuseTalk 1.5 reports real-time audio-driven lip sync and provides realtime inference scripts
- LivePortrait provides high-quality portrait animation primitives such as head motion and retargeting
- `v4l2loopback` gives Linux virtual video devices so generated frames can be presented as a camera

Tradeoffs:

- highest engineering cost
- GPU and model-management overhead
- you own the sync, queueing, rendering, and virtual-device plumbing

Sources:

- [MuseTalk](https://github.com/TMElyralab/MuseTalk)
- [LivePortrait](https://github.com/KlingAIResearch/LivePortrait)
- [v4l2loopback](https://github.com/v4l2loopback/v4l2loopback)

## Face motion: phonemes, visemes, and what you actually need

Phonemes are audio units. Visemes are mouth shapes.

For avatars, visemes are the thing you animate.

Two useful official references:

- Microsoft’s Speech SDK docs explicitly describe `VisemeReceived`, SVG viseme animation for 2D characters, and 3D blend-shape output.
- Amazon Polly defines visemes as the visual equivalent of phonemes and exposes speech-mark output for them.

Sources:

- [Azure Speech viseme docs](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/how-to-speech-synthesis-viseme)
- [Amazon Polly visemes](https://docs.aws.amazon.com/polly/latest/dg/viseme.html)

Practical conclusion:

- If you build a 2D or stylized avatar, use viseme events directly.
- If you build a photoreal talking head with a neural renderer, the renderer usually consumes audio and handles lip motion itself.
- If you want the best expression quality, add a second signal for head pose, blinking, and emotion. Lip sync alone looks dead.

## Recommended architecture

### Recommendation 1: fastest path to product demo

- Meeting joiner: `openutter` or Pika’s meeting session
- Agent speech: hosted TTS or realtime voice model
- Avatar: `Pika`
- Result: quickest path to a bot that visibly joins and talks

### Recommendation 2: best self-hosted path

- Meeting joiner: browser automation container for Meet
- Agent speech loop: separate voice runtime
- Avatar transport: LiveKit room
- Avatar renderer: `bitHuman` GPU worker
- Result: much lower risk than rolling your own neural talking-head stack

### Recommendation 3: best open-source path

- Meeting joiner: `openutter`-style browser automation
- Agent speech loop: STT + LLM + TTS
- Avatar renderer: `MuseTalk` for lip sync, `LivePortrait` for motion control
- Video publishing: `v4l2loopback`
- Audio publishing: PulseAudio virtual source
- Result: maximum control, maximum engineering

## Tooling you will need for the final system

### Core

- Browser automation: Playwright or Puppeteer
- Meeting join base: `openutter` for Meet first
- API/control plane: TypeScript service
- Docker Compose for local orchestration

### Audio

- TTS provider with timestamps or realtime output
- Optional viseme-capable TTS if you use a 2D avatar path
- PulseAudio virtual devices for microphone injection
- ffmpeg for transcoding and stream piping

### Video

- Avatar renderer: Pika, bitHuman, or open-source model stack
- `v4l2loopback` for virtual camera publishing on Linux
- Optional LiveKit if avatar provider already expects room-based publishing

### Intelligence

- STT for live turn-taking if the bot is conversational
- LLM or realtime voice model
- interruption and barge-in handling
- persona / memory prompt assembly

### Reliability

- session lifecycle manager
- transcript and artifact persistence
- retries for blocked joins
- screenshots / debug capture
- health checks and bot state transitions

## Bottom line

If you want the shortest path to "it joins and talks with a face", start with the architecture in this repo:

- use `openutter` as the Meet join base
- keep the agent and avatar runtimes separate
- treat the avatar as a provider abstraction

Then choose one of these:

- `Pika` if you want the fastest visible demo
- `bitHuman + LiveKit` if you want the most realistic self-hosted path
- `MuseTalk + LivePortrait + v4l2loopback` if you want the most open, most customizable stack and are willing to own the complexity
