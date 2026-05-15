import { describe, expect, it } from 'vitest'

import { formatLogEvent } from '../src/discord/MinecraftLogNotifier'
import type { MinecraftLogEvent } from '../src/minecraft/LogParser'

describe('formatLogEvent', () => {
  it('does not include error log contents in Discord notifications', () => {
    const event: MinecraftLogEvent = {
      at: new Date('2026-05-16T00:00:00.000Z'),
      kind: 'error',
      level: 'ERROR',
      line: '[00:00:00] [Server thread/ERROR]: secret stack trace',
      message: 'secret stack trace',
    }

    expect(formatLogEvent(event)).toBe('<t:1778889600:T> [error/ERROR] detected')
  })
})
