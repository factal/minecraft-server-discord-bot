import { MessageFlags, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js'

import type {
  MinecraftCommandResult,
  MinecraftPlayerList,
  MinecraftStatus,
} from '../../app/MinecraftRconService'
import type { MinecraftLogEntry } from '../../app/MinecraftLogService'
import type {
  MinecraftOperationResult,
  MinecraftProcessSnapshot,
} from '../../app/MinecraftSupervisor'
import type { CommandContext, DiscordCommand } from './types'

const DISCORD_MESSAGE_LIMIT = 2_000
const CODE_BLOCK_OVERHEAD = 12
const RESPONSE_RESERVE = 180

export const mcCommand: DiscordCommand = {
  authorization: { kind: 'admin' },
  data: new SlashCommandBuilder()
    .setName('mc')
    .setDescription('Minecraft server を RCON 経由で確認します。')
    .addSubcommand((subcommand) =>
      subcommand
        .setName('status')
        .setDescription('Minecraft server の process と RCON 接続状態を確認します。'),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName('start').setDescription('Minecraft server process を起動します。'),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('stop')
        .setDescription('Minecraft server process を停止します。')
        .addBooleanOption((option) =>
          option
            .setName('force')
            .setDescription('RCON/stdin を使わず即座に kill します。デフォルトは true です。'),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('players')
        .setDescription('Minecraft server のオンライン人数を確認します。'),
    )
    .addSubcommandGroup((group) =>
      group
        .setName('command')
        .setDescription('許可された Minecraft command を RCON 経由で実行します。')
        .addSubcommand((subcommand) =>
          subcommand.setName('list').setDescription('Minecraft の list command を実行します。'),
        ),
    )
    .addSubcommandGroup((group) =>
      group
        .setName('logs')
        .setDescription('Minecraft latest.log を確認します。')
        .addSubcommand((subcommand) =>
          subcommand
            .setName('tail')
            .setDescription('latest.log の末尾を表示します。')
            .addIntegerOption((option) =>
              option
                .setName('lines')
                .setDescription('表示する行数です。')
                .setMinValue(1)
                .setMaxValue(100),
            ),
        ),
    ),
  async execute(interaction, context) {
    await interaction.deferReply({
      flags: MessageFlags.Ephemeral,
    })

    const group = interaction.options.getSubcommandGroup(false)
    const subcommand = interaction.options.getSubcommand()

    if (!group && subcommand === 'status') {
      await handleStatus(interaction, context)
      return
    }

    if (!group && subcommand === 'players') {
      await handlePlayers(interaction, context)
      return
    }

    if (!group && subcommand === 'start') {
      await handleStart(interaction, context)
      return
    }

    if (!group && subcommand === 'stop') {
      await handleStop(interaction, context)
      return
    }

    if (group === 'command' && subcommand === 'list') {
      await handleCommandList(interaction, context)
      return
    }

    if (group === 'logs' && subcommand === 'tail') {
      await handleLogsTail(interaction, context)
      return
    }

    await interaction.editReply('Unsupported `/mc` subcommand.')
  },
}

async function handleStatus(
  interaction: ChatInputCommandInteraction,
  context: CommandContext,
): Promise<void> {
  const status = await context.minecraft.rconService.getStatus()
  const snapshot = context.minecraft.supervisor.getSnapshot()

  await interaction.editReply(formatStatus(status, snapshot))
}

async function handlePlayers(
  interaction: ChatInputCommandInteraction,
  context: CommandContext,
): Promise<void> {
  const playerList = await context.minecraft.rconService.getPlayers()

  await interaction.editReply(formatPlayers(playerList))
}

async function handleStart(
  interaction: ChatInputCommandInteraction,
  context: CommandContext,
): Promise<void> {
  const result = await context.minecraft.supervisor.start()

  await interaction.editReply(
    formatOperationResult('Minecraft start', result, { includeLastError: false }),
  )
}

async function handleStop(
  interaction: ChatInputCommandInteraction,
  context: CommandContext,
): Promise<void> {
  const force = interaction.options.getBoolean('force') ?? true
  const result = await context.minecraft.supervisor.stop(force)

  await interaction.editReply(
    formatOperationResult('Minecraft stop', result, { includeLastError: false }),
  )
}

async function handleCommandList(
  interaction: ChatInputCommandInteraction,
  context: CommandContext,
): Promise<void> {
  const commandResult = await context.minecraft.rconService.runAllowedCommand('list')

  await interaction.editReply(formatCommandResult(commandResult))
}

async function handleLogsTail(
  interaction: ChatInputCommandInteraction,
  context: CommandContext,
): Promise<void> {
  const lineCount = interaction.options.getInteger('lines') ?? 50
  const entries = context.minecraft.logService.tail(lineCount)

  await interaction.editReply(
    formatLogTail(entries, lineCount, context.config.minecraft.logs.latestLogPath),
  )
}

function formatStatus(status: MinecraftStatus, snapshot: MinecraftProcessSnapshot): string {
  const checkedAt = Math.floor(status.checkedAt.getTime() / 1_000)
  const processLines = formatSnapshotLines(snapshot, { includeLastError: false })

  if (!status.rconReachable) {
    return [
      'Minecraft status',
      '',
      ...processLines,
      '',
      'RCON: offline',
      `Error: ${status.errorMessage ?? 'unknown error'}`,
      `Checked: <t:${checkedAt}:R>`,
    ].join('\n')
  }

  const playerSummary = status.playerList
    ? formatPlayerSummary(status.playerList)
    : 'Players: unknown'

  return [
    'Minecraft status',
    '',
    ...processLines,
    '',
    'RCON: online',
    playerSummary,
    `Checked: <t:${checkedAt}:R>`,
  ].join('\n')
}

function formatPlayers(playerList: MinecraftPlayerList): string {
  const names =
    playerList.players.length > 0
      ? playerList.players.map((player) => `- ${player}`).join('\n')
      : 'none'

  return [
    'Minecraft players',
    '',
    formatPlayerSummary(playerList),
    '',
    truncateForDiscord(names),
  ].join('\n')
}

function formatCommandResult(commandResult: MinecraftCommandResult): string {
  const header = `Minecraft command: ${commandResult.command}`
  const body = truncateForDiscord(
    commandResult.responseText,
    DISCORD_MESSAGE_LIMIT - header.length - CODE_BLOCK_OVERHEAD - RESPONSE_RESERVE,
  )

  return `${header}\n\n${codeBlock(body)}`
}

function formatLogTail(
  entries: MinecraftLogEntry[],
  requestedLineCount: number,
  path: string,
): string {
  if (entries.length === 0) {
    return [
      'Minecraft latest.log tail',
      '',
      'No log lines have been captured yet.',
      `Path: ${path}`,
    ].join('\n')
  }

  const headerLines = [
    'Minecraft latest.log tail',
    `Lines: ${entries.length}/${requestedLineCount}`,
    `Path: ${path}`,
    '',
  ]
  const headerLength = headerLines.join('\n').length
  const body = truncateForDiscord(
    entries.map((entry) => entry.line).join('\n'),
    DISCORD_MESSAGE_LIMIT - headerLength - CODE_BLOCK_OVERHEAD - RESPONSE_RESERVE,
  )

  return [...headerLines, codeBlock(body)].join('\n')
}

function formatOperationResult(
  title: string,
  result: MinecraftOperationResult,
  options: FormatSnapshotOptions = {},
): string {
  const lines = [
    title,
    '',
    result.ok ? 'Result: ok' : 'Result: failed',
    `Message: ${result.message}`,
    '',
    ...formatSnapshotLines(result.snapshot, options),
  ]

  if (!result.ok && result.snapshot.recentLogs.length > 0) {
    const recentLogs = result.snapshot.recentLogs.slice(-8).join('\n')

    lines.push('', 'Recent process logs:', codeBlock(truncateForDiscord(recentLogs, 1_000)))
  }

  return lines.join('\n')
}

interface FormatSnapshotOptions {
  includeLastError?: boolean
}

function formatSnapshotLines(
  snapshot: MinecraftProcessSnapshot,
  options: FormatSnapshotOptions = {},
): string[] {
  const lines = [`Process: ${snapshot.state}`]

  if (snapshot.pid) {
    lines.push(`PID: ${snapshot.pid}`)
  }

  if (snapshot.startedAt) {
    lines.push(`Started: <t:${Math.floor(snapshot.startedAt.getTime() / 1_000)}:R>`)
  }

  if (snapshot.readyAt) {
    lines.push(`Ready: <t:${Math.floor(snapshot.readyAt.getTime() / 1_000)}:R>`)
  }

  if (snapshot.lastExit) {
    lines.push(
      `Last exit: code=${snapshot.lastExit.code ?? 'null'} signal=${
        snapshot.lastExit.signal ?? 'null'
      } <t:${Math.floor(snapshot.lastExit.at.getTime() / 1_000)}:R>`,
    )
  }

  if (options.includeLastError !== false && snapshot.lastError) {
    lines.push(`Last error: ${truncateForDiscord(snapshot.lastError, 300)}`)
  }

  return lines
}

function formatPlayerSummary(playerList: MinecraftPlayerList): string {
  if (playerList.onlinePlayers === null || playerList.maxPlayers === null) {
    return `Players: unknown (${playerList.raw})`
  }

  return `Players: ${playerList.onlinePlayers}/${playerList.maxPlayers}`
}

function codeBlock(text: string): string {
  return `\`\`\`text\n${text.replaceAll('```', '`\u200b``')}\n\`\`\``
}

function truncateForDiscord(
  text: string,
  limit = DISCORD_MESSAGE_LIMIT - RESPONSE_RESERVE,
): string {
  if (text.length <= limit) {
    return text
  }

  return `${text.slice(0, Math.max(0, limit - 24))}\n... truncated`
}
