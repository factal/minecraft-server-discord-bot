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

const commaSeparatedListSchema = z
  .string()
  .optional()
  .default('')
  .transform((value) => parseCommaSeparatedList(value))

export const rawEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: logLevelSchema.default('info'),
  DISCORD_TOKEN: z.string().min(1, 'DISCORD_TOKEN is required'),
  DISCORD_CLIENT_ID: snowflakeSchema,
  DISCORD_GUILD_ID: snowflakeSchema,
  DISCORD_ADMIN_ROLE_IDS: snowflakeListSchema,
  DISCORD_ALLOWED_USER_IDS: snowflakeListSchema,
  RCON_HOST: z.string().min(1).default('127.0.0.1'),
  RCON_PORT: z.coerce.number().int().min(1).max(65535).default(25575),
  RCON_PASSWORD: z.string().min(1, 'RCON_PASSWORD is required'),
  RCON_TIMEOUT_MS: z.coerce.number().int().min(500).max(60_000).default(5_000),
  MINECRAFT_CWD: z.string().min(1).default('nomi-ceu-1.7.7-server'),
  MINECRAFT_JAVA_PATH: z.string().min(1).default('java'),
  MINECRAFT_JAR_PATH: z.string().min(1).default('forge-1.12.2-14.23.5.2860.jar'),
  MINECRAFT_JVM_ARGS: commaSeparatedListSchema.default(['-server', '-Xms2048M', '-Xmx2048M']),
  MINECRAFT_SERVER_ARGS: commaSeparatedListSchema.default(['nogui']),
  MINECRAFT_READY_LOG_PATTERN: z.string().min(1).default('Done \\('),
  MINECRAFT_STARTUP_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(900_000).default(180_000),
  MINECRAFT_SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(600_000).default(60_000),
  MINECRAFT_KILL_AFTER_MS: z.coerce.number().int().min(1_000).max(600_000).default(120_000),
  MINECRAFT_LOG_BUFFER_LINES: z.coerce.number().int().min(10).max(2_000).default(200),
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
  }
  minecraft: {
    process: {
      cwd: string
      javaPath: string
      jarPath: string
      jvmArgs: string[]
      serverArgs: string[]
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
