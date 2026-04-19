# Meeting Avatar Bot Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a Dockerized meeting bot foundation that can join Google Meet today through `openutter` and cleanly evolve into a talking avatar bot with a face, motion, and speech loop.

**Architecture:** Split the system into four concerns: control plane, meeting joiner, agent voice loop, and avatar renderer. Keep Google Meet joining separate from avatar generation so the repo can progress from observer mode to avatar mode without a rewrite.

**Tech Stack:** TypeScript, Fastify, `openutter`, Docker Compose, Vitest, and a documented avatar-provider abstraction.

---

### Task 1: Capture the architecture and research in repo docs

**Files:**
- Create: `docs/plans/2026-04-18-meeting-avatar-bot-design.md`
- Create: `docs/research/2026-04-18-avatar-meeting-bot-research.md`
- Modify: `README.md`

**Step 1: Write the design doc**

Document:

- what `AgentZero`, `openutter`, and `Pika-Skills` each contribute
- why Google Meet is the first platform target
- which avatar stack is recommended for each deployment goal
- where visemes fit into the final runtime

**Step 2: Write the research doc**

Include source-backed notes for:

- `openutter`
- `AgentZero`
- `Pika-Skills`
- LiveKit avatar workers
- bitHuman self-hosted GPU container
- MuseTalk 1.5
- Azure / Polly visemes
- `v4l2loopback`

**Step 3: Make the README honest**

Describe what is implemented now versus what is designed but not yet productionized.

### Task 2: Build the Dockerized control plane

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `Dockerfile`
- Create: `docker-compose.yml`
- Create: `.env.example`
- Create: `.gitignore`

**Step 1: Write the failing config tests**

Cover:

- default config values
- env overrides
- invalid env values

**Step 2: Verify the tests fail**

Run:

```bash
npm test
```

Expected: failure because config code does not exist yet.

**Step 3: Implement minimal config + runtime**

Add a small Fastify server with:

- `GET /health`
- `POST /avatar/recommendation`
- `POST /sessions/openutter`
- `GET /sessions`
- `POST /sessions/:id/stop`

**Step 4: Build the Docker image**

Install:

- Node 22
- Chromium and browser dependencies
- `openutter`

Expose port `3000`.

### Task 3: Add the OpenUtter session manager

**Files:**
- Create: `src/providers/openutter-provider.ts`
- Create: `src/services/session-manager.ts`
- Create: `src/routes/register-routes.ts`
- Create: `src/server.ts`
- Create: `src/index.ts`

**Step 1: Write the failing tests for session metadata**

Cover:

- session creation
- log truncation
- status updates from marker lines
- graceful stop behavior

**Step 2: Verify they fail**

Run:

```bash
npm test
```

Expected: failure because the provider and manager do not exist yet.

**Step 3: Implement the minimal joiner wrapper**

Spawn:

```bash
npx openutter join <meet-url> --auth|--anon ...
```

Track:

- PID
- join state
- transcript path
- last logs

### Task 4: Codify the avatar decision logic

**Files:**
- Create: `src/domain/types.ts`
- Create: `src/services/avatar-strategy.ts`
- Create: `src/avatar/cues.ts`
- Create: `test/avatar-strategy.test.ts`
- Create: `test/avatar-cues.test.ts`

**Step 1: Write failing tests for recommendations**

Cases:

- fastest demo → `pika`
- self-hosted photoreal with GPU → `bithuman_livekit`
- open-source requirement with GPU → `musetalk_liveportrait`
- no GPU → `svg_viseme_avatar`

**Step 2: Verify they fail**

Run:

```bash
npm test
```

Expected: failure because the recommendation service does not exist yet.

**Step 3: Implement minimal strategy logic**

Return:

- provider id
- reasons
- required tooling
- operational risks
- source links

**Step 4: Add a small viseme utility**

Translate timed viseme events into mouth cues so the repo contains reusable face-motion primitives.

### Task 5: Verify the starter stack

**Files:**
- Modify: `README.md`

**Step 1: Install dependencies**

Run:

```bash
npm install
```

**Step 2: Run the test suite**

Run:

```bash
npm test
```

Expected: all tests pass.

**Step 3: Run the build**

Run:

```bash
npm run build
```

Expected: successful TypeScript build.

**Step 4: Smoke test the API**

Run:

```bash
npm run dev
curl http://localhost:3000/health
```

Expected: JSON health response.

**Step 5: Commit**

```bash
git add .
git commit -m "feat: scaffold dockerized meeting avatar bot control plane"
```

Note: this repo was not initialized as a git repository during this session, so the commit step is pending until `git init` or the repo is connected to your remote.
