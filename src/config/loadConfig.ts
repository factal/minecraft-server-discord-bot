import { join, resolve } from 'node:path'

import dotenv from 'dotenv'

import { type AppConfig, rawEnvSchema } from './schema'

export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
  }
}

export function loadEnvFiles(cwd = process.cwd()): void {
  dotenv.config({ path: join(cwd, '.env.local'), override: false, quiet: true })
  dotenv.config({ path: join(cwd, '.env'), override: false, quiet: true })
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = rawEnvSchema.safeParse(env)

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'env'}: ${issue.message}`)
      .join('; ')

    throw new ConfigError(`Invalid environment configuration. ${details}`)
  }

  const raw = parsed.data
  const minecraftCwd = resolve(raw.MINECRAFT_CWD)

  return {
    env: raw.NODE_ENV,
    logLevel: raw.LOG_LEVEL,
    discord: {
      token: raw.DISCORD_TOKEN,
      clientId: raw.DISCORD_CLIENT_ID,
      guildId: raw.DISCORD_GUILD_ID,
      adminRoleIds: raw.DISCORD_ADMIN_ROLE_IDS,
      allowedUserIds: raw.DISCORD_ALLOWED_USER_IDS,
      minecraftErrorChannelId: raw.DISCORD_MINECRAFT_ERROR_CHANNEL_ID,
      minecraftEventChannelId: raw.DISCORD_MINECRAFT_EVENT_CHANNEL_ID,
    },
    minecraft: {
      logs: {
        bufferLines: raw.MINECRAFT_LOG_BUFFER_LINES,
        latestLogPath: resolve(minecraftCwd, raw.MINECRAFT_LATEST_LOG_PATH),
        notificationBatchLines: raw.MINECRAFT_LOG_NOTIFY_BATCH_LINES,
        notificationBatchMs: raw.MINECRAFT_LOG_NOTIFY_BATCH_MS,
        pollIntervalMs: raw.MINECRAFT_LOG_TAIL_POLL_MS,
      },
      process: {
        cwd: minecraftCwd,
        startScript: resolve(minecraftCwd, raw.MINECRAFT_START_SCRIPT),
        readyLogPattern: compileRegExp(
          raw.MINECRAFT_READY_LOG_PATTERN,
          'MINECRAFT_READY_LOG_PATTERN',
        ),
        startupTimeoutMs: raw.MINECRAFT_STARTUP_TIMEOUT_MS,
        shutdownTimeoutMs: raw.MINECRAFT_SHUTDOWN_TIMEOUT_MS,
        killAfterMs: raw.MINECRAFT_KILL_AFTER_MS,
        logBufferLines: raw.MINECRAFT_LOG_BUFFER_LINES,
      },
      rcon: {
        host: raw.RCON_HOST,
        port: raw.RCON_PORT,
        password: raw.RCON_PASSWORD,
        timeoutMs: raw.RCON_TIMEOUT_MS,
      },
    },
  }
}

function compileRegExp(pattern: string, envName: string): RegExp {
  try {
    return new RegExp(pattern)
  } catch (error) {
    throw new ConfigError(`Invalid ${envName}. ${(error as Error).message}`)
  }
}
