export type MinecraftLogEventKind = 'death' | 'error' | 'join' | 'leave'

export interface MinecraftLogEvent {
  at: Date
  kind: MinecraftLogEventKind
  level?: string
  line: string
  message: string
  player?: string
}

const playerNamePattern = '[A-Za-z0-9_]{1,16}'
const logLevelPattern = /\[[^\]]+\/(?<level>TRACE|DEBUG|INFO|WARN|ERROR|FATAL)\]/

const deathMessagePatterns = [
  new RegExp(
    `^(?<player>${playerNamePattern}) was (?:slain|shot|killed|fireballed|pummeled|impaled|blown up)\\b`,
    'i',
  ),
  new RegExp(
    `^(?<player>${playerNamePattern}) was (?:squashed|stung|obliterated|burned|doomed|poked)\\b`,
    'i',
  ),
  new RegExp(
    `^(?<player>${playerNamePattern}) (?:fell|drowned|died|starved|suffocated|froze|withered)`,
    'i',
  ),
  new RegExp(
    `^(?<player>${playerNamePattern}) (?:blew up|hit the ground|experienced kinetic energy)`,
    'i',
  ),
  new RegExp(`^(?<player>${playerNamePattern}) (?:tried to swim|walked into|discovered)`, 'i'),
  new RegExp(`^(?<player>${playerNamePattern}) (?:went up|went off|fell out)`, 'i'),
]

const errorKeywordPattern = /\b(?:crash(?:ed)?|exception|fatal|watchdog)\b/i

export function parseMinecraftLogLine(line: string, at = new Date()): MinecraftLogEvent | null {
  const level = parseLogLevel(line)
  const message = parseLogMessage(line)
  const joinMatch = new RegExp(`^(?<player>${playerNamePattern}) joined the game$`).exec(message)

  if (joinMatch?.groups?.player) {
    return {
      at,
      kind: 'join',
      level,
      line,
      message,
      player: joinMatch.groups.player,
    }
  }

  const leaveMatch = new RegExp(`^(?<player>${playerNamePattern}) left the game$`).exec(message)

  if (leaveMatch?.groups?.player) {
    return {
      at,
      kind: 'leave',
      level,
      line,
      message,
      player: leaveMatch.groups.player,
    }
  }

  for (const deathPattern of deathMessagePatterns) {
    const deathMatch = deathPattern.exec(message)
    const player = deathMatch?.groups?.player

    if (player) {
      return {
        at,
        kind: 'death',
        level,
        line,
        message,
        player,
      }
    }
  }

  if (level === 'ERROR' || level === 'FATAL' || errorKeywordPattern.test(message)) {
    return {
      at,
      kind: 'error',
      level,
      line,
      message,
    }
  }

  return null
}

function parseLogLevel(line: string): string | undefined {
  return logLevelPattern.exec(line)?.groups?.level
}

function parseLogMessage(line: string): string {
  const messageMarkerIndex = line.lastIndexOf(']: ')

  if (messageMarkerIndex === -1) {
    return line.trim()
  }

  return line.slice(messageMarkerIndex + 3).trim()
}
