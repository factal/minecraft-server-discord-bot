import { describe, expect, it, vi } from 'vitest'

import { formatLogEvent, MinecraftLogNotifier } from '../src/discord/MinecraftLogNotifier'
import { createLogger } from '../src/infra/logger'
import type { MinecraftLogEvent } from '../src/minecraft/LogParser'
import type { MinecraftLogEventListener } from '../src/app/MinecraftLogService'

class FakeLogService {
  private listener: MinecraftLogEventListener | undefined

  emit(event: MinecraftLogEvent): void {
    this.listener?.(event)
  }

  onEvent(listener: MinecraftLogEventListener): () => void {
    this.listener = listener

    return () => {
      this.listener = undefined
    }
  }
}

describe('formatLogEvent', () => {
  it('does not include error log contents when formatting an error event', () => {
    const event: MinecraftLogEvent = {
      at: new Date('2026-05-16T00:00:00.000Z'),
      kind: 'error',
      level: 'ERROR',
      line: '[00:00:00] [Server thread/ERROR]: secret stack trace',
      message: 'secret stack trace',
    }

    expect(formatLogEvent(event)).toBe('<t:1778889600:T> [error] detected')
  })

  it('does not send Discord notifications for error events', () => {
    const logService = new FakeLogService()
    const fetch = vi.fn()
    const notifier = new MinecraftLogNotifier(
      {
        channels: {
          fetch,
        },
      } as never,
      logService as never,
      {
        adminRoleIds: [],
        allowedUserIds: [],
        clientId: '123456789012345678',
        guildId: '234567890123456789',
        logs: {
          bufferLines: 200,
          latestLogPath: '/tmp/latest.log',
          notificationBatchLines: 1,
          notificationBatchMs: 1000,
          pollIntervalMs: 1000,
        },
        minecraftEventChannelId: '567890123456789012',
        token: 'test-token',
      },
      createLogger({ env: 'test', logLevel: 'silent' }),
    )

    notifier.start()
    logService.emit({
      at: new Date('2026-05-16T00:00:00.000Z'),
      kind: 'error',
      level: 'ERROR',
      line: '[00:00:00] [Server thread/ERROR]: noisy mod error',
      message: 'noisy mod error',
    })

    expect(fetch).not.toHaveBeenCalled()
  })
})
