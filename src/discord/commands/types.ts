import type {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  SlashCommandOptionsOnlyBuilder,
  SlashCommandSubcommandsOnlyBuilder,
} from 'discord.js'

import type { AppConfig } from '../../config/schema'
import type { AppLogger } from '../../infra/logger'
import type { MinecraftLogService } from '../../app/MinecraftLogService'
import type { MinecraftRconService } from '../../app/MinecraftRconService'
import type { MinecraftSupervisor } from '../../app/MinecraftSupervisor'
import type { AuthorizationPolicy } from '../authorization'

export type DiscordCommandBuilder =
  | SlashCommandBuilder
  | SlashCommandOptionsOnlyBuilder
  | SlashCommandSubcommandsOnlyBuilder

export interface CommandContext {
  config: AppConfig
  logger: AppLogger
  minecraft: {
    logService: MinecraftLogService
    rconService: MinecraftRconService
    supervisor: MinecraftSupervisor
  }
}

export interface DiscordCommand {
  authorization: AuthorizationPolicy
  data: DiscordCommandBuilder
  execute(interaction: ChatInputCommandInteraction, context: CommandContext): Promise<void>
}
