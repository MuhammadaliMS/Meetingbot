# Meetingbot

An open-source, self-hosted AI meeting agent that joins Google Meet as a real participant — listens via live captions, thinks with an LLM, talks back through synthesized voice, and shows up as a viseme-animated avatar on video. A hackable alternative to hosted meeting-bot APIs.

## Demo

https://github.com/user-attachments/assets/20b0f6ec-c3bf-429a-b452-a5ea6359c679

This repo now contains a Dockerized TypeScript control plane for a meeting bot and a research-backed avatar architecture plan.

What is implemented now:

- A Fastify API that can start and stop Google Meet observer sessions through [`openutter`](https://github.com/sumansid/openutter).
- An avatar strategy engine that chooses between `Pika`, `bitHuman + LiveKit`, and a fully open-source stack based on deployment goals.
- A small viseme/mouth-cue module so the repo has actual face-motion logic rather than only notes.
- Docker assets and persistence mounts for browser-auth and transcript state.

What is intentionally not claimed as complete yet:

- A production-grade talking-face renderer that publishes a live video tile into Meet.
- A virtual-camera pipeline wired all the way from avatar frames to `/dev/video*`.
- A two-way speech loop with STT, LLM, TTS, interruption handling, and full meeting participation.

That split is deliberate. The browser-join problem and the avatar-rendering problem are separate systems. `openutter` solves the first one well enough to use as a base. The repo docs explain the second one and recommend the least painful path depending on whether you want the fastest demo, a self-hosted production build, or a fully open-source stack.

## Quick Start

```bash
npm install
npm run dev
```

Health check:

```bash
curl http://localhost:3000/health
```

Create an architecture recommendation:

```bash
curl -X POST http://localhost:3000/avatar/recommendation \
  -H "content-type: application/json" \
  -d '{
    "meetingPlatform": "google_meet",
    "deploymentGoal": "self_hosted",
    "gpuAvailability": "consumer",
    "needsPhotorealism": true,
    "needsLowLatency": true
  }'
```

Start an observer session through OpenUtter:

```bash
curl -X POST http://localhost:3000/sessions/openutter \
  -H "content-type: application/json" \
  -d '{
    "meetingUrl": "https://meet.google.com/abc-defg-hij",
    "joinMode": "anon",
    "botName": "Meetingbot"
  }'
```

## Docker

```bash
docker compose up --build
```

The compose stack persists `~/.openutter` and `~/.openclaw` state inside Docker volumes so auth sessions and transcripts survive restarts.

If you later add a live avatar video pipeline, the next host-level step is usually:

1. Load `v4l2loopback` on the host.
2. Expose a virtual camera device into the container.
3. Feed avatar frames into that device from a renderer process.
4. Join Meet with camera enabled instead of audio-only observation.

That design is documented in [docs/research/2026-04-18-avatar-meeting-bot-research.md](docs/research/2026-04-18-avatar-meeting-bot-research.md) and [docs/plans/2026-04-18-meeting-avatar-bot-design.md](docs/plans/2026-04-18-meeting-avatar-bot-design.md).

## API

### `GET /health`

Returns server health and the configured OpenUtter command.

### `POST /avatar/recommendation`

Returns a researched avatar architecture recommendation. This is where the repo captures the reasoning from `Pika-Skills`, `AgentZero`, `openutter`, LiveKit, bitHuman, MuseTalk, and viseme docs.

### `POST /sessions/openutter`

Starts an `openutter join` process and tracks its lifecycle in memory.

Request body:

```json
{
  "meetingUrl": "https://meet.google.com/abc-defg-hij",
  "joinMode": "anon",
  "botName": "Meetingbot",
  "headed": false,
  "duration": "45m"
}
```

### `GET /sessions`

Lists tracked sessions and their last-known state.

### `POST /sessions/:id/stop`

Stops a running `openutter` process.

## Research Summary

- `AgentZero` already models a long-running Docker meeting bot service with scheduling, recording, transcription, and webhook processing.
- `openutter` is a good Google Meet joiner/caption-capture base, but it is an observer bot, not a talking avatar bot.
- `Pika-Skills` shows the product pattern you want: a bot that joins a meeting as an avatar with a custom face and voice.
- For the avatar tile itself, the practical choices are:
  - `Pika`: fastest hosted demo.
  - `bitHuman + LiveKit`: strongest self-hosted near-production path.
  - `MuseTalk + LivePortrait + v4l2loopback`: most open-source control, most engineering.

## Notes

- The current code targets Google Meet first because `openutter` is Google Meet-specific.
- The `avatar recommendation` route is intentionally opinionated. It is there so this repo can answer the "which stack should I use?" question consistently instead of re-deciding it every time.
- If you want the next iteration to implement the actual talking avatar runtime, the design doc already breaks the work into joiner, voice loop, renderer, and virtual-device plumbing.
