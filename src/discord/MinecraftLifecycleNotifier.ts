import type { Client, MessageCreateOptions } from 'discord.js'

import type { MinecraftLifecycleEvent, MinecraftSupervisor } from '../app/MinecraftSupervisor'
import type { AppConfig } from '../config/schema'
import type { AppLogger } from '../infra/logger'

interface SendableTextChannel {
  send(options: MessageCreateOptions): Promise<unknown>
}

export class MinecraftLifecycleNotifier {
  private unsubscribe: (() => void) | undefined

  constructor(
    private readonly client: Client,
    private readonly supervisor: MinecraftSupervisor,
    private readonly config: AppConfig['discord'],
    private readonly logger: AppLogger,
  ) {}

  start(): void {
    if (this.unsubscribe) {
      return
    }

    this.unsubscribe = this.supervisor.onLifecycleEvent((event) => {
      void this.send(event).catch((error: unknown) => {
        this.logger.warn({ err: error }, 'failed to send minecraft lifecycle notification')
      })
    })
  }

  stop(): void {
    this.unsubscribe?.()
    this.unsubscribe = undefined
  }

  private async send(event: MinecraftLifecycleEvent): Promise<void> {
    if (!this.config.minecraftEventChannelId) {
      return
    }

    const channel = await this.client.channels.fetch(this.config.minecraftEventChannelId)

    if (!isSendableTextChannel(channel)) {
      this.logger.warn(
        { channelId: this.config.minecraftEventChannelId },
        'minecraft lifecycle notification channel cannot receive messages',
      )
      return
    }

    await channel.send({
      allowedMentions: {
        parse: [],
      },
      content: formatLifecycleEvent(event),
    })
  }
}

export function formatLifecycleEvent(event: MinecraftLifecycleEvent): string {
  const timestamp = `<t:${Math.floor(event.at.getTime() / 1_000)}:T>`

  if (event.kind === 'started') {
    return `${timestamp} [server] started`
  }

  if (event.kind === 'stopped') {
    return `${timestamp} [server] stopped`
  }

  return `${timestamp} [server] crashed`
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
