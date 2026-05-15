import { open, readFile, stat } from 'node:fs/promises'

import type { AppConfig } from '../config/schema'
import type { AppLogger } from '../infra/logger'
import { parseMinecraftLogLine, type MinecraftLogEvent } from '../minecraft/LogParser'

export interface MinecraftLogEntry {
  at: Date
  line: string
}

export type MinecraftLogEventListener = (event: MinecraftLogEvent) => void

const readChunkSize = 64 * 1024

export class MinecraftLogService {
  private readonly eventListeners = new Set<MinecraftLogEventListener>()
  private readonly logLines: MinecraftLogEntry[] = []

  private pollInFlight = false
  private position = 0
  private remainder = ''
  private started = false
  private timer: NodeJS.Timeout | undefined

  constructor(
    private readonly config: AppConfig['minecraft']['logs'],
    private readonly logger: AppLogger,
  ) {}

  onEvent(listener: MinecraftLogEventListener): () => void {
    this.eventListeners.add(listener)

    return () => {
      this.eventListeners.delete(listener)
    }
  }

  tail(lineCount: number): MinecraftLogEntry[] {
    return this.logLines.slice(-lineCount)
  }

  async start(): Promise<void> {
    if (this.started) {
      return
    }

    try {
      this.logLines.length = 0
      await this.loadInitialBuffer()
      await this.seekToEnd()

      this.timer = setInterval(() => {
        void this.poll().catch((error: unknown) => {
          this.logger.warn({ err: error }, 'failed to poll minecraft latest.log')
        })
      }, this.config.pollIntervalMs)
      this.timer.unref?.()
      this.started = true

      this.logger.info({ path: this.config.latestLogPath }, 'started minecraft latest.log tail')
    } catch (error) {
      this.stop()
      throw error
    }
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = undefined
    }

    this.started = false
  }

  private async loadInitialBuffer(): Promise<void> {
    const lines = await readRecentLogLines(this.config.latestLogPath, this.config.bufferLines)

    for (const line of lines) {
      this.recordLine(line, false)
    }
  }

  private async seekToEnd(): Promise<void> {
    try {
      const fileStat = await stat(this.config.latestLogPath)

      this.position = fileStat.size
      this.remainder = ''
    } catch (error) {
      if (isMissingFileError(error)) {
        this.position = 0
        this.remainder = ''
        return
      }

      throw error
    }
  }

  private async poll(): Promise<void> {
    if (this.pollInFlight) {
      return
    }

    this.pollInFlight = true

    try {
      await this.pollOnce()
    } finally {
      this.pollInFlight = false
    }
  }

  private async pollOnce(): Promise<void> {
    let fileStat: Awaited<ReturnType<typeof stat>>

    try {
      fileStat = await stat(this.config.latestLogPath)
    } catch (error) {
      if (isMissingFileError(error)) {
        return
      }

      throw error
    }

    if (fileStat.size < this.position) {
      this.logger.info({ path: this.config.latestLogPath }, 'minecraft latest.log was truncated')
      this.position = 0
      this.remainder = ''
    }

    if (fileStat.size === this.position) {
      return
    }

    const text = await this.readNewText(fileStat.size)

    this.collectText(text)
  }

  private async readNewText(fileSize: number): Promise<string> {
    const fileHandle = await open(this.config.latestLogPath, 'r')
    const chunks: Buffer[] = []
    let nextPosition = this.position

    try {
      while (nextPosition < fileSize) {
        const length = Math.min(readChunkSize, fileSize - nextPosition)
        const buffer = Buffer.allocUnsafe(length)
        const { bytesRead } = await fileHandle.read(buffer, 0, length, nextPosition)

        if (bytesRead === 0) {
          break
        }

        chunks.push(buffer.subarray(0, bytesRead))
        nextPosition += bytesRead
      }
    } finally {
      await fileHandle.close()
    }

    this.position = nextPosition

    return Buffer.concat(chunks).toString('utf8')
  }

  private collectText(text: string): void {
    const lines = (this.remainder + text).split(/\r?\n/)

    this.remainder = lines.pop() ?? ''

    for (const line of lines) {
      this.recordLine(line, true)
    }
  }

  private recordLine(line: string, emitEvents: boolean): void {
    const trimmedLine = line.trimEnd()

    if (!trimmedLine) {
      return
    }

    const entry = {
      at: new Date(),
      line: trimmedLine,
    }

    this.logLines.push(entry)

    while (this.logLines.length > this.config.bufferLines) {
      this.logLines.shift()
    }

    if (!emitEvents) {
      return
    }

    const event = parseMinecraftLogLine(trimmedLine, entry.at)

    if (event) {
      this.emitEvent(event)
    }
  }

  private emitEvent(event: MinecraftLogEvent): void {
    for (const listener of this.eventListeners) {
      listener(event)
    }
  }
}

export async function readRecentLogLines(filePath: string, lineCount: number): Promise<string[]> {
  try {
    const text = await readFile(filePath, 'utf8')

    return text
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter(Boolean)
      .slice(-lineCount)
  } catch (error) {
    if (isMissingFileError(error)) {
      return []
    }

    throw error
  }
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}
