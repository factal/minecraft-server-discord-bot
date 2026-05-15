import { describe, expect, it } from 'vitest'

import {
  authorizeInteraction,
  extractRoleIds,
  type AuthorizableInteraction,
} from '../src/discord/authorization'
import type { AppConfig } from '../src/config/schema'

const config: AppConfig = {
  env: 'test',
  logLevel: 'silent',
  discord: {
    token: 'test-token',
    clientId: '123456789012345678',
    guildId: '234567890123456789',
    adminRoleIds: ['345678901234567890'],
    allowedUserIds: ['456789012345678901'],
  },
  minecraft: {
    process: {
      cwd: '/tmp/minecraft',
      javaPath: 'java',
      jarPath: 'server.jar',
      jvmArgs: ['-Xms1G', '-Xmx1G'],
      serverArgs: ['nogui'],
      readyLogPattern: /Done \(/,
      startupTimeoutMs: 1000,
      shutdownTimeoutMs: 1000,
      killAfterMs: 1000,
      logBufferLines: 100,
    },
    rcon: {
      host: '127.0.0.1',
      port: 25575,
      password: 'test-rcon-password',
      timeoutMs: 5000,
    },
  },
}

function interaction(userId: string, roleIds: string[]): AuthorizableInteraction {
  return {
    guildId: config.discord.guildId,
    member: {
      roles: roleIds,
    },
    user: {
      id: userId,
    },
  }
}

describe('extractRoleIds', () => {
  it('supports API-style role ID arrays', () => {
    expect(
      extractRoleIds(interaction('567890123456789012', ['345678901234567890']).member),
    ).toEqual(['345678901234567890'])
  })
})

describe('authorizeInteraction', () => {
  it('allows public commands', () => {
    expect(
      authorizeInteraction(interaction('567890123456789012', []), { kind: 'public' }, config),
    ).toEqual({
      ok: true,
    })
  })

  it('allows admin commands for configured roles', () => {
    expect(
      authorizeInteraction(
        interaction('567890123456789012', ['345678901234567890']),
        { kind: 'admin' },
        config,
      ),
    ).toEqual({ ok: true })
  })

  it('allows admin commands for configured users', () => {
    expect(
      authorizeInteraction(interaction('456789012345678901', []), { kind: 'admin' }, config),
    ).toEqual({ ok: true })
  })

  it('denies admin commands without an allowed role or user', () => {
    const result = authorizeInteraction(
      interaction('567890123456789012', ['678901234567890123']),
      { kind: 'admin' },
      config,
    )

    expect(result).toMatchObject({
      ok: false,
      reason: 'User is not in an allowed admin role.',
    })
  })
})
