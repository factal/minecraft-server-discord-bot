import { describe, expect, it } from 'vitest'
import { resolve } from 'node:path'

import { loadConfig } from '../src/config/loadConfig'
import { parseSnowflakeList } from '../src/config/schema'

const validEnv = {
  DISCORD_TOKEN: 'test-token',
  DISCORD_CLIENT_ID: '123456789012345678',
  DISCORD_GUILD_ID: '234567890123456789',
  RCON_PASSWORD: 'test-rcon-password',
}

describe('parseSnowflakeList', () => {
  it('returns an empty list for missing values', () => {
    expect(parseSnowflakeList(undefined)).toEqual([])
  })

  it('trims, filters, and deduplicates IDs', () => {
    expect(
      parseSnowflakeList('123456789012345678, 234567890123456789,123456789012345678,,'),
    ).toEqual(['123456789012345678', '234567890123456789'])
  })
})

describe('loadConfig', () => {
  it('loads the required Discord configuration', () => {
    const config = loadConfig({
      ...validEnv,
      DISCORD_ADMIN_ROLE_IDS: '345678901234567890',
      DISCORD_ALLOWED_USER_IDS: '456789012345678901',
      LOG_LEVEL: 'debug',
      NODE_ENV: 'test',
    })

    expect(config).toMatchObject({
      env: 'test',
      logLevel: 'debug',
      discord: {
        adminRoleIds: ['345678901234567890'],
        allowedUserIds: ['456789012345678901'],
        clientId: '123456789012345678',
        guildId: '234567890123456789',
      },
      minecraft: {
        process: {
          cwd: resolve('nomi-ceu-1.7.7-server'),
          javaPath: 'java',
          jarPath: 'forge-1.12.2-14.23.5.2860.jar',
          jvmArgs: ['-server', '-Xms2048M', '-Xmx2048M'],
          serverArgs: ['nogui'],
          startupTimeoutMs: 180000,
          shutdownTimeoutMs: 60000,
          killAfterMs: 120000,
          logBufferLines: 200,
        },
        rcon: {
          host: '127.0.0.1',
          port: 25575,
          timeoutMs: 5000,
        },
      },
    })
  })

  it('throws a useful error when required Discord values are missing', () => {
    expect(() => loadConfig({ ...validEnv, DISCORD_TOKEN: '' })).toThrow(/DISCORD_TOKEN/)
  })

  it('rejects invalid role IDs', () => {
    expect(() =>
      loadConfig({
        ...validEnv,
        DISCORD_ADMIN_ROLE_IDS: 'not-a-role',
      }),
    ).toThrow(/Invalid Discord snowflake ID/)
  })

  it('loads explicit RCON options', () => {
    const config = loadConfig({
      ...validEnv,
      RCON_HOST: 'localhost',
      RCON_PORT: '25580',
      RCON_TIMEOUT_MS: '3000',
    })

    expect(config.minecraft.rcon).toMatchObject({
      host: 'localhost',
      port: 25580,
      password: 'test-rcon-password',
      timeoutMs: 3000,
    })
  })

  it('loads explicit Minecraft process options', () => {
    const config = loadConfig({
      ...validEnv,
      MINECRAFT_CWD: 'custom-server',
      MINECRAFT_JAVA_PATH: '/usr/bin/java',
      MINECRAFT_JAR_PATH: 'server.jar',
      MINECRAFT_JVM_ARGS: '-Xms1G,-Xmx2G',
      MINECRAFT_SERVER_ARGS: 'nogui,--demo',
      MINECRAFT_READY_LOG_PATTERN: 'Server ready',
      MINECRAFT_STARTUP_TIMEOUT_MS: '2000',
      MINECRAFT_SHUTDOWN_TIMEOUT_MS: '3000',
      MINECRAFT_KILL_AFTER_MS: '4000',
      MINECRAFT_LOG_BUFFER_LINES: '50',
    })

    expect(config.minecraft.process).toMatchObject({
      cwd: resolve('custom-server'),
      javaPath: '/usr/bin/java',
      jarPath: 'server.jar',
      jvmArgs: ['-Xms1G', '-Xmx2G'],
      serverArgs: ['nogui', '--demo'],
      startupTimeoutMs: 2000,
      shutdownTimeoutMs: 3000,
      killAfterMs: 4000,
      logBufferLines: 50,
    })
    expect(config.minecraft.process.readyLogPattern.test('Server ready')).toBe(true)
  })
})
