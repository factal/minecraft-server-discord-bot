import { MessageFlags, SlashCommandBuilder } from 'discord.js'

import type { DiscordCommand } from './types'

export const pingCommand: DiscordCommand = {
  authorization: { kind: 'public' },
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Discord bot の応答を確認します。'),
  async execute(interaction) {
    const websocketPingMs = interaction.client.ws.ping
    const receivedAt = interaction.createdTimestamp
    const interactionLatencyMs = Math.max(0, Date.now() - receivedAt)

    await interaction.reply({
      content: `Pong! gateway=${websocketPingMs}ms interaction=${interactionLatencyMs}ms`,
      flags: MessageFlags.Ephemeral,
    })
  },
}
