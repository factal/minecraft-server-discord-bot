import type { Client, MessageCreateOptions } from 'discord.js'

import type { MinecraftLogService } from '../app/MinecraftLogService'
import type { AppConfig } from '../config/schema'
import type { AppLogger } from '../infra/logger'
import type { MinecraftLogEvent } from '../minecraft/LogParser'

const discordMessageLimit = 2_000
const maxEventLineLength = 500

interface ChannelBatch {
  lines: string[]
  timer: NodeJS.Timeout
}

interface SendableTextChannel {
  send(options: MessageCreateOptions): Promise<unknown>
}

export class MinecraftLogNotifier {
  private readonly batches = new Map<string, ChannelBatch>()

  private unsubscribe: (() => void) | undefined

  constructor(
    private readonly client: Client,
    private readonly logService: MinecraftLogService,
    private readonly config: AppConfig['discord'] & Pick<AppConfig['minecraft'], 'logs'>,
    private readonly logger: AppLogger,
  ) {}

  start(): void {
    if (this.unsubscribe) {
      return
    }

    this.unsubscribe = this.logService.onEvent((event) => this.enqueue(event))
  }

  stop(): void {
    this.unsubscribe?.()
    this.unsubscribe = undefined

    for (const [channelId, batch] of this.batches) {
      clearTimeout(batch.timer)
      this.batches.delete(channelId)
    }
  }

  private enqueue(event: MinecraftLogEvent): void {
    const channelId = this.channelIdForEvent(event)

    if (!channelId) {
      return
    }

    const existingBatch = this.batches.get(channelId)
    const batch = existingBatch ?? this.createBatch(channelId)

    batch.lines.push(formatLogEvent(event))

    if (batch.lines.length >= this.config.logs.notificationBatchLines) {
      this.flush(channelId)
    }
  }

  private createBatch(channelId: string): ChannelBatch {
    const timer = setTimeout(() => this.flush(channelId), this.config.logs.notificationBatchMs)
    const batch = {
      lines: [],
      timer,
    }

    timer.unref?.()
    this.batches.set(channelId, batch)

    return batch
  }

  private flush(channelId: string): void {
    const batch = this.batches.get(channelId)

    if (!batch) {
      return
    }

    clearTimeout(batch.timer)
    this.batches.delete(channelId)

    if (batch.lines.length === 0) {
      return
    }

    void this.sendBatch(channelId, batch.lines).catch((error: unknown) => {
      this.logger.warn({ channelId, err: error }, 'failed to send minecraft log notification')
    })
  }

  private async sendBatch(channelId: string, lines: string[]): Promise<void> {
    const channel = await this.client.channels.fetch(channelId)

    if (!isSendableTextChannel(channel)) {
      this.logger.warn({ channelId }, 'minecraft log notification channel cannot receive messages')
      return
    }

    for (const content of buildDiscordMessages('Minecraft log events', lines)) {
      await channel.send({
        allowedMentions: {
          parse: [],
        },
        content,
      })
    }
  }

  private channelIdForEvent(event: MinecraftLogEvent): string | undefined {
    if (event.kind === 'error') {
      return this.config.minecraftErrorChannelId ?? this.config.minecraftEventChannelId
    }

    return this.config.minecraftEventChannelId
  }
}

export function formatLogEvent(event: MinecraftLogEvent): string {
  const timestamp = `<t:${Math.floor(event.at.getTime() / 1_000)}:T>`
  const message = truncateForDiscordLine(escapeDiscordMentions(event.message))

  if (event.kind === 'join') {
    return `${timestamp} [join] ${event.player} joined the game`
  }

  if (event.kind === 'leave') {
    return `${timestamp} [leave] ${event.player} left the game`
  }

  if (event.kind === 'death') {
    return `${timestamp} [death] ${message}`
  }

  const level = event.level ? `/${event.level}` : ''

  return `${timestamp} [error${level}] detected`
}

export function buildDiscordMessages(header: string, lines: string[]): string[] {
  const messages: string[] = []
  let current = `${header}\n`

  for (const line of lines) {
    const normalizedLine = truncateForDiscordLine(line)

    if (current.length + normalizedLine.length + 1 > discordMessageLimit) {
      messages.push(current.trimEnd())
      current = `${header}\n`
    }

    current += `${normalizedLine}\n`
  }

  if (current.trim()) {
    messages.push(current.trimEnd())
  }

  return messages
}

function escapeDiscordMentions(text: string): string {
  return text.replaceAll('@', '@\u200b')
}

function truncateForDiscordLine(text: string): string {
  if (text.length <= maxEventLineLength) {
    return text
  }

  return `${text.slice(0, maxEventLineLength - 14)}... truncated`
}

function isSendableTextChannel(channel: unknown): channel is SendableTextChannel {
  if (typeof channel !== 'object' || channel === null) {
    return false
  }

  const candidate = channel as Record<string, unknown>
  const isTextBased = candidate.isTextBased
  const send = candidate.send

  return (
    typeof isTextBased === 'function' &&
    isTextBased.call(channel) === true &&
    typeof send === 'function'
  )
}
