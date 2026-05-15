import { describe, expect, it, vi } from 'vitest'

import {
  formatLifecycleEvent,
  MinecraftLifecycleNotifier,
} from '../src/discord/MinecraftLifecycleNotifier'
import { createLogger } from '../src/infra/logger'
import type {
  MinecraftLifecycleEvent,
  MinecraftLifecycleEventListener,
} from '../src/app/MinecraftSupervisor'

class FakeSupervisor {
  private listener: MinecraftLifecycleEventListener | undefined

  emit(event: MinecraftLifecycleEvent): void {
    this.listener?.(event)
  }

  onLifecycleEvent(listener: MinecraftLifecycleEventListener): () => void {
    this.listener = listener

    return () => {
      this.listener = undefined
    }
  }
}

function event(kind: MinecraftLifecycleEvent['kind']): MinecraftLifecycleEvent {
  return {
    at: new Date('2026-05-16T00:00:00.000Z'),
    kind,
    snapshot: {
      recentLogs: [],
      state: kind === 'started' ? 'running' : kind,
    },
  }
}

describe('formatLifecycleEvent', () => {
  it('formats server lifecycle messages for Discord', () => {
    expect(formatLifecycleEvent(event('started'))).toBe('<t:1778889600:T> [server] started')
    expect(formatLifecycleEvent(event('stopped'))).toBe('<t:1778889600:T> [server] stopped')
    expect(formatLifecycleEvent(event('crashed'))).toBe('<t:1778889600:T> [server] crashed')
  })

  it('sends lifecycle messages to the configured Minecraft event channel', async () => {
    const supervisor = new FakeSupervisor()
    const send = vi.fn().mockResolvedValue(undefined)
    const fetch = vi.fn().mockResolvedValue({
      isTextBased: () => true,
      send,
    })
    const notifier = new MinecraftLifecycleNotifier(
      {
        channels: {
          fetch,
        },
      } as never,
      supervisor as never,
      {
        adminRoleIds: [],
        allowedUserIds: [],
        clientId: '123456789012345678',
        guildId: '234567890123456789',
        minecraftEventChannelId: '567890123456789012',
        token: 'test-token',
      },
      createLogger({ env: 'test', logLevel: 'silent' }),
    )

    notifier.start()
    supervisor.emit(event('started'))
    await Promise.resolve()
    await Promise.resolve()

    expect(fetch).toHaveBeenCalledWith('567890123456789012')
    expect(send).toHaveBeenCalledWith({
      allowedMentions: {
        parse: [],
      },
      content: '<t:1778889600:T> [server] started',
    })
  })
})
