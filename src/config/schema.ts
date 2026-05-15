import { z } from 'zod'

const discordSnowflakePattern = /^\d{17,20}$/

export const logLevelSchema = z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])

export type LogLevel = z.infer<typeof logLevelSchema>

export function parseSnowflakeList(value: string | undefined): string[] {
  return parseCommaSeparatedList(value)
}

export function parseCommaSeparatedList(value: string | undefined): string[] {
  if (!value) {
    return []
  }

  return Array.from(
    new Set(
      value
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  )
}

const snowflakeSchema = z.string().regex(discordSnowflakePattern, 'Expected a Discord snowflake ID')

const optionalSnowflakeSchema = z
  .string()
  .optional()
  .default('')
  .transform((value, context) => {
    const id = value.trim()

    if (!id) {
      return undefined
    }

    if (!discordSnowflakePattern.test(id)) {
      context.addIssue({
        code: 'custom',
        message: `Invalid Discord snowflake ID: ${id}`,
      })
      return z.NEVER
    }

    return id
  })

const snowflakeListSchema = z
  .string()
  .optional()
  .default('')
  .transform((value, context) => {
    const ids = parseSnowflakeList(value)
    const invalidId = ids.find((id) => !discordSnowflakePattern.test(id))

    if (invalidId) {
      context.addIssue({
        code: 'custom',
        message: `Invalid Discord snowflake ID: ${invalidId}`,
      })
      return z.NEVER
    }

    return ids
  })

export const rawEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: logLevelSchema.default('info'),
  DISCORD_TOKEN: z.string().min(1, 'DISCORD_TOKEN is required'),
  DISCORD_CLIENT_ID: snowflakeSchema,
  DISCORD_GUILD_ID: snowflakeSchema,
  DISCORD_ADMIN_ROLE_IDS: snowflakeListSchema,
  DISCORD_ALLOWED_USER_IDS: snowflakeListSchema,
  DISCORD_MINECRAFT_EVENT_CHANNEL_ID: optionalSnowflakeSchema,
  RCON_HOST: z.string().min(1).default('127.0.0.1'),
  RCON_PORT: z.coerce.number().int().min(1).max(65535).default(25575),
  RCON_PASSWORD: z.string().min(1, 'RCON_PASSWORD is required'),
  RCON_TIMEOUT_MS: z.coerce.number().int().min(500).max(60_000).default(5_000),
  MINECRAFT_CWD: z.string().min(1).default('server'),
  MINECRAFT_LATEST_LOG_PATH: z.string().min(1).default('logs/latest.log'),
  MINECRAFT_START_SCRIPT: z.string().min(1).default('launch.sh'),
  MINECRAFT_READY_LOG_PATTERN: z.string().min(1).default('Done \\('),
  MINECRAFT_STARTUP_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(900_000).default(180_000),
  MINECRAFT_SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(600_000).default(60_000),
  MINECRAFT_KILL_AFTER_MS: z.coerce.number().int().min(1_000).max(600_000).default(120_000),
  MINECRAFT_LOG_BUFFER_LINES: z.coerce.number().int().min(10).max(2_000).default(200),
  MINECRAFT_LOG_TAIL_POLL_MS: z.coerce.number().int().min(250).max(60_000).default(1_000),
  MINECRAFT_LOG_NOTIFY_BATCH_MS: z.coerce.number().int().min(1_000).max(60_000).default(5_000),
  MINECRAFT_LOG_NOTIFY_BATCH_LINES: z.coerce.number().int().min(1).max(50).default(20),
})

export type RawEnv = z.infer<typeof rawEnvSchema>

export interface AppConfig {
  env: RawEnv['NODE_ENV']
  logLevel: LogLevel
  discord: {
    token: string
    clientId: string
    guildId: string
    adminRoleIds: string[]
    allowedUserIds: string[]
    minecraftEventChannelId?: string
  }
  minecraft: {
    logs: {
      bufferLines: number
      latestLogPath: string
      notificationBatchLines: number
      notificationBatchMs: number
      pollIntervalMs: number
    }
    process: {
      cwd: string
      startScript: string
      readyLogPattern: RegExp
      startupTimeoutMs: number
      shutdownTimeoutMs: number
      killAfterMs: number
      logBufferLines: number
    }
    rcon: {
      host: string
      port: number
      password: string
      timeoutMs: number
    }
  }
}
