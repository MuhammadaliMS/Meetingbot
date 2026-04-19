import 'dotenv/config'
import { z } from 'zod'

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().min(1).default('0.0.0.0'),
  OPENUTTER_BIN: z.string().min(1).default('npx'),
  OPENUTTER_CWD: z.string().min(1).default(process.cwd()),
  ALLOW_HOSTED_AVATAR_PROVIDERS: z
    .string()
    .optional()
    .transform((value) => value === 'true'),
  HEADTTS_URL: z.string().min(1).default('http://localhost:8882'),
  HEADTTS_VOICE: z.string().min(1).default('af_bella'),
  MINIMAX_API_KEY: z.string().min(1).default(''),
  MINIMAX_MODEL: z.string().min(1).default('MiniMax-M2.7-highspeed'),
  MINIMAX_BASE_URL: z.string().min(1).default('https://api.minimax.io/v1/chat/completions'),
})

export type AppConfig = z.infer<typeof envSchema>

export function parseConfig(environment: NodeJS.ProcessEnv): AppConfig {
  const result = envSchema.safeParse(environment)

  if (!result.success) {
    throw new Error(`Invalid environment configuration: ${result.error.message}`)
  }

  return result.data
}

export const config = parseConfig(process.env)
