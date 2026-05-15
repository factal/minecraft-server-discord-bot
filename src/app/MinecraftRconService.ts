import type { RconPort } from '../minecraft/RconPort'

export interface MinecraftPlayerList {
  maxPlayers: number | null
  onlinePlayers: number | null
  players: string[]
  raw: string
}

export interface MinecraftStatus {
  checkedAt: Date
  errorMessage?: string
  playerList?: MinecraftPlayerList
  rconReachable: boolean
}

export type AllowedMinecraftCommand = 'list'

export interface MinecraftCommandResult {
  command: AllowedMinecraftCommand
  responseText: string
  raw: string
}

export class MinecraftRconService {
  constructor(private readonly createRcon: () => RconPort) {}

  async getStatus(): Promise<MinecraftStatus> {
    try {
      const playerList = await this.getPlayers()

      return {
        checkedAt: new Date(),
        playerList,
        rconReachable: true,
      }
    } catch (error) {
      return {
        checkedAt: new Date(),
        errorMessage: toUserFacingRconError(error),
        rconReachable: false,
      }
    }
  }

  async getPlayers(): Promise<MinecraftPlayerList> {
    const response = await this.sendRconCommand('list')

    return parseMinecraftListResponse(response)
  }

  async runAllowedCommand(command: AllowedMinecraftCommand): Promise<MinecraftCommandResult> {
    const raw = await this.sendRconCommand(command)

    return {
      command,
      responseText: raw.trim() || 'No response was returned by the server.',
      raw,
    }
  }

  private async sendRconCommand(command: string): Promise<string> {
    const rcon = this.createRcon()

    try {
      await rcon.connect()
      return await rcon.send(command)
    } finally {
      await rcon.disconnect()
    }
  }
}

export function parseMinecraftListResponse(response: string): MinecraftPlayerList {
  const raw = response.trim()
  const patterns = [
    /^There are (?<online>\d+) of a max of (?<max>\d+) players online(?::\s*(?<players>.*))?$/i,
    /^There are (?<online>\d+)\/(?<max>\d+) players online(?::\s*(?<players>.*))?$/i,
  ]

  for (const pattern of patterns) {
    const match = pattern.exec(raw)
    const groups = match?.groups

    if (!groups) {
      continue
    }

    return {
      maxPlayers: Number(groups.max),
      onlinePlayers: Number(groups.online),
      players: parsePlayers(groups.players ?? ''),
      raw,
    }
  }

  return {
    maxPlayers: null,
    onlinePlayers: null,
    players: [],
    raw,
  }
}

export function toUserFacingRconError(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return 'Unknown RCON error.'
}

function parsePlayers(playersText: string): string[] {
  const trimmed = playersText.trim()

  if (!trimmed) {
    return []
  }

  return trimmed
    .split(',')
    .map((player) => player.trim())
    .filter(Boolean)
}
