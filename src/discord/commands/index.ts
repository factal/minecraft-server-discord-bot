import { mcCommand } from './mc'
import { pingCommand } from './ping'
import type { DiscordCommand } from './types'

export const discordCommands = [pingCommand, mcCommand] as const satisfies readonly DiscordCommand[]
