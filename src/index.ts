import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { config } from './config.js'
import { createApp } from './server.js'
import { HeadTTSProvider } from './providers/headtts-provider.js'
import { AgentLoop } from './services/agent-loop.js'

function startHeadTTS(): Promise<void> {
  return new Promise((res, rej) => {
    const headTTSPath = join(process.env.HOME || '/root', 'HeadTTS')
    const child = spawn('node', ['./modules/headtts-node.mjs'], {
      cwd: headTTSPath,
      stdio: 'inherit',
      detached: true,
    })

    child.on('error', (err: Error) => {
      console.error('Failed to start HeadTTS:', err.message)
      rej(err)
    })

    child.unref()

    setTimeout(() => res(), 2000)
  })
}

async function waitForHeadTTS(url: string, retries = 10): Promise<void> {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(`${url}/v1/synthesize`, { method: 'OPTIONS' })
      if (res.ok || res.status === 405) return
    } catch {}
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error(`HeadTTS not reachable at ${url} after ${retries}s`)
}

async function main(): Promise<void> {
  try {
    await waitForHeadTTS(config.HEADTTS_URL, 3)
    console.log('HeadTTS already running')
  } catch {
    console.log('Starting HeadTTS...')
    await startHeadTTS()
    await waitForHeadTTS(config.HEADTTS_URL)
    console.log('HeadTTS started')
  }

  const headTTS = new HeadTTSProvider(config.HEADTTS_URL)
  const agentLoop = config.MINIMAX_API_KEY
    ? new AgentLoop(config.MINIMAX_API_KEY, config.MINIMAX_MODEL, config.MINIMAX_BASE_URL)
    : null

  const app = createApp(config, headTTS, agentLoop)

  await app.listen({
    port: config.PORT,
    host: config.HOST,
  })
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
