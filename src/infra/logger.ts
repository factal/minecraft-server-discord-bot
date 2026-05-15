import pino, { type Logger, type LoggerOptions } from 'pino'

import type { AppConfig } from '../config/schema'

export type AppLogger = Logger

export function createLogger(config: Pick<AppConfig, 'env' | 'logLevel'>): AppLogger {
  const options: LoggerOptions = {
    base: {
      env: config.env,
      service: 'minecraft-server-discord-bot',
    },
    level: config.logLevel,
    redact: {
      censor: '[redacted]',
      paths: [
        'config.discord.token',
        'config.minecraft.rcon.password',
        'discord.token',
        'DISCORD_TOKEN',
        'RCON_PASSWORD',
        'rcon.password',
        'req.headers.authorization',
        'token',
      ],
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  }

  return pino(options)
}
