import {
  spawn,
  type ChildProcessWithoutNullStreams,
  type SpawnOptionsWithoutStdio,
} from 'node:child_process'

import type { AppConfig } from '../config/schema'
import type { AppLogger } from '../infra/logger'
import type { RconPort } from '../minecraft/RconPort'
import { OperationQueue } from './OperationQueue'

export type MinecraftServerState =
  | 'stopped'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'crashed'
  | 'unknown'

export interface MinecraftProcessSnapshot {
  lastError?: string
  lastExit?: {
    at: Date
    code: number | null
    signal: NodeJS.Signals | null
  }
  pid?: number
  readyAt?: Date
  recentLogs: string[]
  startedAt?: Date
  state: MinecraftServerState
  stoppedAt?: Date
}

export interface MinecraftOperationResult {
  message: string
  ok: boolean
  snapshot: MinecraftProcessSnapshot
}

type ProcessSpawner = (
  command: string,
  args: string[],
  options: SpawnOptionsWithoutStdio,
) => ChildProcessWithoutNullStreams

interface StateWaiter {
  predicate(snapshot: MinecraftProcessSnapshot): boolean
  resolve(snapshot: MinecraftProcessSnapshot | null): void
  timer: NodeJS.Timeout
}

export class MinecraftSupervisor {
  private readonly logLines: string[] = []
  private readonly operationQueue = new OperationQueue()
  private readonly waiters: StateWaiter[] = []

  private process: ChildProcessWithoutNullStreams | undefined
  private state: MinecraftServerState = 'stopped'
  private lastError: string | undefined
  private lastExit: MinecraftProcessSnapshot['lastExit']
  private readyAt: Date | undefined
  private startedAt: Date | undefined
  private stoppedAt: Date | undefined
  private stdoutBuffer = ''
  private stderrBuffer = ''

  constructor(
    private readonly config: AppConfig['minecraft']['process'],
    private readonly createRcon: () => RconPort,
    private readonly logger: AppLogger,
    private readonly spawnProcess: ProcessSpawner = spawn,
  ) {}

  getSnapshot(): MinecraftProcessSnapshot {
    return {
      lastError: this.lastError,
      lastExit: this.lastExit,
      pid: this.process?.pid,
      readyAt: this.readyAt,
      recentLogs: [...this.logLines],
      startedAt: this.startedAt,
      state: this.state,
      stoppedAt: this.stoppedAt,
    }
  }

  async start(): Promise<MinecraftOperationResult> {
    return this.operationQueue.run(() => this.startInternal())
  }

  async stop(force: boolean): Promise<MinecraftOperationResult> {
    return this.operationQueue.run(() => this.stopInternal(force))
  }

  private async startInternal(): Promise<MinecraftOperationResult> {
    if (this.state === 'running') {
      return this.result(true, 'Minecraft server is already running.')
    }

    if (this.state === 'starting') {
      return this.result(true, 'Minecraft server is already starting.')
    }

    if (this.state === 'stopping') {
      return this.result(false, 'Minecraft server is currently stopping.')
    }

    this.clearForStart()

    const args = [...this.config.jvmArgs, '-jar', this.config.jarPath, ...this.config.serverArgs]

    this.logger.info(
      {
        args,
        cwd: this.config.cwd,
        javaPath: this.config.javaPath,
      },
      'starting minecraft server process',
    )

    const child = this.spawnProcess(this.config.javaPath, args, {
      cwd: this.config.cwd,
      stdio: 'pipe',
    })

    this.process = child
    this.startedAt = new Date()
    this.setState('starting')

    child.stdout.on('data', (chunk: Buffer) => this.collectLogChunk('stdout', chunk))
    child.stderr.on('data', (chunk: Buffer) => this.collectLogChunk('stderr', chunk))
    child.once('error', (error) => this.handleProcessError(error))
    child.once('exit', (code, signal) => this.handleProcessExit(code, signal))

    const readySnapshot = await this.waitForState(
      (snapshot) =>
        snapshot.state === 'running' ||
        snapshot.state === 'crashed' ||
        snapshot.state === 'stopped',
      this.config.startupTimeoutMs,
    )

    if (!readySnapshot) {
      return this.result(
        false,
        'Minecraft server process started, but ready log was not seen before timeout.',
      )
    }

    if (readySnapshot.state === 'running') {
      return this.result(true, 'Minecraft server is running.')
    }

    return this.result(
      false,
      `Minecraft server did not start cleanly. State: ${readySnapshot.state}.`,
    )
  }

  private async stopInternal(force: boolean): Promise<MinecraftOperationResult> {
    const child = this.process

    if (!child || this.state === 'stopped') {
      this.setState('stopped')
      return this.result(true, 'Minecraft server is already stopped.')
    }

    if (this.state === 'crashed') {
      return this.result(false, 'Minecraft server process has already crashed.')
    }

    this.setState('stopping')

    if (force) {
      this.killProcess(child, 'SIGKILL')
    } else {
      await this.requestGracefulStop(child)
    }

    const stoppedSnapshot = await this.waitForState(
      (snapshot) => snapshot.state === 'stopped' || snapshot.state === 'crashed',
      force ? this.config.killAfterMs : this.config.shutdownTimeoutMs,
    )

    if (stoppedSnapshot?.state === 'stopped') {
      return this.result(true, 'Minecraft server stopped.')
    }

    if (!force) {
      this.logger.warn('minecraft server did not stop before graceful timeout; terminating process')
      this.killProcess(child, 'SIGTERM')

      const terminatedSnapshot = await this.waitForState(
        (snapshot) => snapshot.state === 'stopped' || snapshot.state === 'crashed',
        this.config.killAfterMs,
      )

      if (terminatedSnapshot?.state === 'stopped') {
        return this.result(true, 'Minecraft server stopped after termination signal.')
      }

      this.logger.warn('minecraft server did not stop after termination signal; killing process')
      this.killProcess(child, 'SIGKILL')
    }

    const killedSnapshot = await this.waitForState(
      (snapshot) => snapshot.state === 'stopped' || snapshot.state === 'crashed',
      this.config.killAfterMs,
    )

    if (killedSnapshot?.state === 'stopped') {
      return this.result(true, 'Minecraft server stopped after kill signal.')
    }

    return this.result(false, 'Minecraft server did not exit before timeout.')
  }

  private async requestGracefulStop(child: ChildProcessWithoutNullStreams): Promise<void> {
    try {
      const rcon = this.createRcon()

      try {
        await rcon.connect()
        await rcon.send('stop')
        this.logger.info('sent minecraft stop command through RCON')
        return
      } finally {
        await rcon.disconnect()
      }
    } catch (error) {
      this.logger.warn(
        { err: error },
        'failed to stop minecraft through RCON; falling back to stdin',
      )
    }

    try {
      child.stdin.write('stop\n')
      this.logger.info('sent minecraft stop command through stdin')
    } catch (error) {
      this.logger.warn({ err: error }, 'failed to write minecraft stop command to stdin')
    }
  }

  private handleProcessError(error: Error): void {
    this.lastError = error.message
    this.logger.error({ err: error }, 'minecraft process error')

    if (this.state === 'starting' || this.state === 'running') {
      this.setState('crashed')
    }
  }

  private handleProcessExit(code: number | null, signal: NodeJS.Signals | null): void {
    const previousState = this.state

    this.lastExit = {
      at: new Date(),
      code,
      signal,
    }
    this.process = undefined
    this.stoppedAt = new Date()
    this.flushLogBuffers()

    if (previousState === 'stopping' || previousState === 'stopped') {
      this.setState('stopped')
      this.logger.info({ code, signal }, 'minecraft process stopped')
      return
    }

    this.lastError = `Minecraft process exited unexpectedly with code ${code ?? 'null'} and signal ${
      signal ?? 'null'
    }.`
    this.setState('crashed')
    this.logger.error({ code, signal, previousState }, 'minecraft process crashed')
  }

  private collectLogChunk(stream: 'stderr' | 'stdout', chunk: Buffer): void {
    if (stream === 'stdout') {
      this.stdoutBuffer = this.collectLines(stream, this.stdoutBuffer + chunk.toString('utf8'))
      return
    }

    this.stderrBuffer = this.collectLines(stream, this.stderrBuffer + chunk.toString('utf8'))
  }

  private collectLines(stream: 'stderr' | 'stdout', text: string): string {
    const lines = text.split(/\r?\n/)
    const remainder = lines.pop() ?? ''

    for (const line of lines) {
      this.recordLogLine(stream, line)
    }

    return remainder
  }

  private recordLogLine(stream: 'stderr' | 'stdout', line: string): void {
    const trimmedLine = line.trimEnd()

    if (!trimmedLine) {
      return
    }

    const entry = `[${stream}] ${trimmedLine}`
    this.logLines.push(entry)

    while (this.logLines.length > this.config.logBufferLines) {
      this.logLines.shift()
    }

    this.detectImportantLogLine(trimmedLine)
  }

  private detectImportantLogLine(line: string): void {
    this.config.readyLogPattern.lastIndex = 0

    if (this.state === 'starting' && this.config.readyLogPattern.test(line)) {
      this.readyAt = new Date()
      this.setState('running')
      this.logger.info('minecraft server ready log detected')
      return
    }

    if (/(crash|exception|watchdog|fatal|error)/i.test(line)) {
      this.lastError = line
    }
  }

  private flushLogBuffers(): void {
    if (this.stdoutBuffer.trim()) {
      this.recordLogLine('stdout', this.stdoutBuffer)
    }

    if (this.stderrBuffer.trim()) {
      this.recordLogLine('stderr', this.stderrBuffer)
    }

    this.stdoutBuffer = ''
    this.stderrBuffer = ''
  }

  private killProcess(child: ChildProcessWithoutNullStreams, signal: NodeJS.Signals): void {
    if (child.killed) {
      return
    }

    child.kill(signal)
  }

  private clearForStart(): void {
    this.lastError = undefined
    this.lastExit = undefined
    this.readyAt = undefined
    this.startedAt = undefined
    this.stoppedAt = undefined
    this.stdoutBuffer = ''
    this.stderrBuffer = ''
  }

  private setState(state: MinecraftServerState): void {
    this.state = state
    this.notifyWaiters()
  }

  private waitForState(
    predicate: (snapshot: MinecraftProcessSnapshot) => boolean,
    timeoutMs: number,
  ): Promise<MinecraftProcessSnapshot | null> {
    const snapshot = this.getSnapshot()

    if (predicate(snapshot)) {
      return Promise.resolve(snapshot)
    }

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.removeWaiter(timer)
        resolve(null)
      }, timeoutMs)

      this.waiters.push({
        predicate,
        resolve,
        timer,
      })
    })
  }

  private notifyWaiters(): void {
    const snapshot = this.getSnapshot()

    for (const waiter of [...this.waiters]) {
      if (!waiter.predicate(snapshot)) {
        continue
      }

      this.removeWaiter(waiter.timer)
      clearTimeout(waiter.timer)
      waiter.resolve(snapshot)
    }
  }

  private removeWaiter(timer: NodeJS.Timeout): void {
    const waiterIndex = this.waiters.findIndex((waiter) => waiter.timer === timer)

    if (waiterIndex !== -1) {
      this.waiters.splice(waiterIndex, 1)
    }
  }

  private result(ok: boolean, message: string): MinecraftOperationResult {
    return {
      message,
      ok,
      snapshot: this.getSnapshot(),
    }
  }
}
