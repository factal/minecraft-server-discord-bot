import { REST, Routes, type RESTPostAPIChatInputApplicationCommandsJSONBody } from 'discord.js'

import { loadConfig, loadEnvFiles } from '../config/loadConfig'
import type { AppConfig } from '../config/schema'
import { createLogger, type AppLogger } from '../infra/logger'
import { discordCommands } from './commands'
import type { DiscordCommand } from './commands/types'

export function getCommandPayloads(
  commands: readonly DiscordCommand[] = discordCommands,
): RESTPostAPIChatInputApplicationCommandsJSONBody[] {
  return commands.map((command) => command.data.toJSON())
}

export async function registerDiscordCommands(
  config: AppConfig,
  logger: AppLogger,
  commands: readonly DiscordCommand[] = discordCommands,
): Promise<void> {
  const rest = new REST({ version: '10' }).setToken(config.discord.token)
  const payloads = getCommandPayloads(commands)

  await rest.put(Routes.applicationGuildCommands(config.discord.clientId, config.discord.guildId), {
    body: payloads,
  })

  logger.info(
    {
      commandCount: payloads.length,
      guildId: config.discord.guildId,
    },
    'registered guild slash commands',
  )
}

if (require.main === module) {
  loadEnvFiles()
  const config = loadConfig()
  const logger = createLogger(config)

  registerDiscordCommands(config, logger).catch((error: unknown) => {
    logger.fatal({ err: error }, 'failed to register slash commands')
    process.exitCode = 1
  })
}
