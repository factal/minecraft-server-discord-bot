import type { Client } from 'discord.js'

import { MinecraftLogService } from './app/MinecraftLogService'
import { MinecraftRconService } from './app/MinecraftRconService'
import { MinecraftSupervisor } from './app/MinecraftSupervisor'
import { PublicIpService } from './app/PublicIpService'
import type { AppConfig } from './config/schema'
import { attachCommandRouter } from './discord/commandRouter'
import { discordCommands } from './discord/commands'
import { createDiscordClient } from './discord/client'
import { MinecraftLifecycleNotifier } from './discord/MinecraftLifecycleNotifier'
import { MinecraftLogNotifier } from './discord/MinecraftLogNotifier'
import type { AppLogger } from './infra/logger'
import { RconAdapter } from './minecraft/RconAdapter'

export async function bootstrap(config: AppConfig, logger: AppLogger): Promise<Client> {
  const client = createDiscordClient()
  const rconLogger = logger.child({ component: 'rcon' })
  const rconService = new MinecraftRconService(
    () => new RconAdapter(config.minecraft.rcon, rconLogger),
  )
  const publicIpService = new PublicIpService(config.minecraft.publicIp)
  const logService = new MinecraftLogService(
    config.minecraft.logs,
    logger.child({ component: 'minecraft-log-service' }),
  )
  const logNotifier = new MinecraftLogNotifier(
    client,
    logService,
    {
      ...config.discord,
      logs: config.minecraft.logs,
    },
    logger.child({ component: 'minecraft-log-notifier' }),
  )
  const supervisor = new MinecraftSupervisor(
    config.minecraft.process,
    () => new RconAdapter(config.minecraft.rcon, rconLogger),
    logger.child({ component: 'minecraft-supervisor' }),
  )
  const lifecycleNotifier = new MinecraftLifecycleNotifier(
    client,
    supervisor,
    config.discord,
    logger.child({ component: 'minecraft-lifecycle-notifier' }),
  )

  attachCommandRouter(client, discordCommands, {
    config,
    logger,
    minecraft: {
      logService,
      publicIpService,
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

    logNotifier.start()
    lifecycleNotifier.start()
    void logService.start().catch((error: unknown) => {
      logger.error({ err: error }, 'failed to start minecraft latest.log tail')
    })
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
