import { Collection, MessageFlags, type ChatInputCommandInteraction, type Client } from 'discord.js'

import { authorizeInteraction } from './authorization'
import type { CommandContext, DiscordCommand } from './commands/types'

export function createCommandMap(
  commands: readonly DiscordCommand[],
): Collection<string, DiscordCommand> {
  const commandMap = new Collection<string, DiscordCommand>()

  for (const command of commands) {
    commandMap.set(command.data.name, command)
  }

  return commandMap
}

export function attachCommandRouter(
  client: Client,
  commands: readonly DiscordCommand[],
  context: CommandContext,
): void {
  const commandMap = createCommandMap(commands)

  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) {
      return
    }

    await handleChatInputCommand(interaction, commandMap, context)
  })
}

async function handleChatInputCommand(
  interaction: ChatInputCommandInteraction,
  commandMap: Collection<string, DiscordCommand>,
  context: CommandContext,
): Promise<void> {
  const command = commandMap.get(interaction.commandName)
  const logger = context.logger.child({
    commandName: interaction.commandName,
    guildId: interaction.guildId,
    interactionId: interaction.id,
    userId: interaction.user.id,
  })

  if (!command) {
    logger.warn('unknown slash command received')
    await interaction.reply({
      content: 'Unknown command.',
      flags: MessageFlags.Ephemeral,
    })
    return
  }

  const authorization = authorizeInteraction(interaction, command.authorization, context.config)

  if (!authorization.ok) {
    logger.warn({ reason: authorization.reason }, 'slash command authorization denied')
    await interaction.reply({
      content: 'このコマンドを実行する権限がありません。',
      flags: MessageFlags.Ephemeral,
    })
    return
  }

  const startedAt = Date.now()

  try {
    await command.execute(interaction, {
      ...context,
      logger,
    })
    logger.info({ durationMs: Date.now() - startedAt }, 'slash command completed')
  } catch (error) {
    logger.error({ err: error, durationMs: Date.now() - startedAt }, 'slash command failed')
    await sendCommandFailure(interaction)
  }
}

async function sendCommandFailure(interaction: ChatInputCommandInteraction): Promise<void> {
  const content = 'コマンド実行中にエラーが発生しました。'

  if (interaction.deferred) {
    await interaction.editReply({ content })
    return
  }

  if (interaction.replied) {
    await interaction.followUp({
      content,
      flags: MessageFlags.Ephemeral,
    })
    return
  }

  await interaction.reply({
    content,
    flags: MessageFlags.Ephemeral,
  })
}
