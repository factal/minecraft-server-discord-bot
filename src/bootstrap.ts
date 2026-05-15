import type { Client } from 'discord.js'

import { MinecraftRconService } from './app/MinecraftRconService'
import { MinecraftSupervisor } from './app/MinecraftSupervisor'
import type { AppConfig } from './config/schema'
import { attachCommandRouter } from './discord/commandRouter'
import { discordCommands } from './discord/commands'
import { createDiscordClient } from './discord/client'
import type { AppLogger } from './infra/logger'
import { RconAdapter } from './minecraft/RconAdapter'

export async function bootstrap(config: AppConfig, logger: AppLogger): Promise<Client> {
  const client = createDiscordClient()
  const rconLogger = logger.child({ component: 'rcon' })
  const rconService = new MinecraftRconService(
    () => new RconAdapter(config.minecraft.rcon, rconLogger),
  )
  const supervisor = new MinecraftSupervisor(
    config.minecraft.process,
    () => new RconAdapter(config.minecraft.rcon, rconLogger),
    logger.child({ component: 'minecraft-supervisor' }),
  )

  attachCommandRouter(client, discordCommands, {
    config,
    logger,
    minecraft: {
      rconService,
      supervisor,
    },
  })

  client.once('clientReady', (readyClient) => {
    logger.info(
      {
        guildId: config.discord.guildId,
        userId: readyClient.user.id,
        userTag: readyClient.user.tag,
      },
      'discord client ready',
    )
  })

  client.on('warn', (message) => {
    logger.warn({ message }, 'discord client warning')
  })

  client.on('error', (error) => {
    logger.error({ err: error }, 'discord client error')
  })

  await client.login(config.discord.token)

  return client
}
