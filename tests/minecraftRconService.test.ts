import { describe, expect, it } from 'vitest'

import { MinecraftRconService, parseMinecraftListResponse } from '../src/app/MinecraftRconService'
import type { RconPort } from '../src/minecraft/RconPort'

class FakeRconPort implements RconPort {
  public readonly commands: string[] = []

  constructor(private readonly response: string) {}

  async connect(): Promise<void> {}

  async disconnect(): Promise<void> {}

  async send(command: string): Promise<string> {
    this.commands.push(command)
    return this.response
  }

  isConnected(): boolean {
    return true
  }
}

describe('parseMinecraftListResponse', () => {
  it('parses modern list output', () => {
    expect(
      parseMinecraftListResponse('There are 2 of a max of 20 players online: alex, steve'),
    ).toEqual({
      maxPlayers: 20,
      onlinePlayers: 2,
      players: ['alex', 'steve'],
      raw: 'There are 2 of a max of 20 players online: alex, steve',
    })
  })

  it('parses legacy 1.12 style list output', () => {
    expect(parseMinecraftListResponse('There are 1/20 players online: alex')).toMatchObject({
      maxPlayers: 20,
      onlinePlayers: 1,
      players: ['alex'],
    })
  })

  it('keeps unknown list output for display', () => {
    expect(parseMinecraftListResponse('custom server response')).toEqual({
      maxPlayers: null,
      onlinePlayers: null,
      players: [],
      raw: 'custom server response',
    })
  })
})

describe('MinecraftRconService', () => {
  it('runs only the fixed list command for the command-list milestone', async () => {
    const fakeRcon = new FakeRconPort('There are 0/20 players online:')
    const service = new MinecraftRconService(() => fakeRcon)

    await expect(service.runAllowedCommand('list')).resolves.toMatchObject({
      command: 'list',
      responseText: 'There are 0/20 players online:',
    })
    expect(fakeRcon.commands).toEqual(['list'])
  })
})
