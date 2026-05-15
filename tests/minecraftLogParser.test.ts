import { describe, expect, it } from 'vitest'

import { parseMinecraftLogLine } from '../src/minecraft/LogParser'

const at = new Date('2026-05-16T00:00:00.000Z')

describe('parseMinecraftLogLine', () => {
  it('parses player joins from vanilla latest.log lines', () => {
    expect(
      parseMinecraftLogLine('[12:34:56] [Server thread/INFO]: alex joined the game', at),
    ).toMatchObject({
      at,
      kind: 'join',
      level: 'INFO',
      player: 'alex',
    })
  })

  it('parses player leaves from Forge-style latest.log lines', () => {
    expect(
      parseMinecraftLogLine(
        '[12:34:56] [Server thread/INFO] [minecraft/PlayerList]: steve left the game',
        at,
      ),
    ).toMatchObject({
      kind: 'leave',
      level: 'INFO',
      player: 'steve',
    })
  })

  it('parses common death messages', () => {
    expect(
      parseMinecraftLogLine('[12:34:56] [Server thread/INFO]: alex was slain by Zombie', at),
    ).toMatchObject({
      kind: 'death',
      player: 'alex',
    })
    expect(
      parseMinecraftLogLine('[12:34:56] [Server thread/INFO]: steve was blown up by Creeper', at),
    ).toMatchObject({
      kind: 'death',
      player: 'steve',
    })
  })

  it('parses error lines and keeps the user-facing message', () => {
    expect(
      parseMinecraftLogLine(
        '[12:34:56] [Server thread/ERROR] [minecraft/MinecraftServer]: Encountered an unexpected exception',
        at,
      ),
    ).toMatchObject({
      kind: 'error',
      level: 'ERROR',
      message: 'Encountered an unexpected exception',
    })
  })

  it('ignores ordinary info lines', () => {
    expect(parseMinecraftLogLine('[12:34:56] [Server thread/INFO]: Saving chunks', at)).toBeNull()
  })
})
