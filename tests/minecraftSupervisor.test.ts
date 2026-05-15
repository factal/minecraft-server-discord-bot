import { EventEmitter } from 'node:events'
import { PassThrough, Writable } from 'node:stream'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'

import { describe, expect, it } from 'vitest'

import { MinecraftSupervisor } from '../src/app/MinecraftSupervisor'
import { createLogger } from '../src/infra/logger'
import type { RconPort } from '../src/minecraft/RconPort'
import type { AppConfig } from '../src/config/schema'

const processConfig: AppConfig['minecraft']['process'] = {
  cwd: '/tmp/minecraft',
  killAfterMs: 50,
  logBufferLines: 20,
  readyLogPattern: /Done \(/,
  startScript: '/tmp/minecraft/launch.sh',
  shutdownTimeoutMs: 50,
  startupTimeoutMs: 50,
}

const logger = createLogger({
  env: 'test',
  logLevel: 'silent',
})

class FakeMinecraftProcess extends EventEmitter {
  public readonly pid = 1234
  public killed = false
  public readonly stdout = new PassThrough()
  public readonly stderr = new PassThrough()
  public readonly stdin = new Writable({
    write: (chunk, _encoding, callback) => {
      this.stdinWrites.push(chunk.toString())
      callback()
    },
  })
  public readonly stdinWrites: string[] = []
  public readonly signals: NodeJS.Signals[] = []

  kill(signal: NodeJS.Signals): boolean {
    this.killed = true
    this.signals.push(signal)
    this.emit('exit', null, signal)
    return true
  }
}

class FakeRconPort implements RconPort {
  public readonly commands: string[] = []

  constructor(private readonly onSend?: (command: string) => void) {}

  async connect(): Promise<void> {}

  async disconnect(): Promise<void> {}

  async send(command: string): Promise<string> {
    this.commands.push(command)
    this.onSend?.(command)
    return ''
  }

  isConnected(): boolean {
    return true
  }
}

describe('MinecraftSupervisor', () => {
  it('marks the server running when the ready log is observed', async () => {
    const fakeProcess = new FakeMinecraftProcess()
    const spawnCalls: Array<{ args: string[]; command: string }> = []
    const supervisor = new MinecraftSupervisor(
      processConfig,
      () => new FakeRconPort(),
      logger,
      (command, args) => {
        spawnCalls.push({ args, command })
        return fakeProcess as unknown as ChildProcessWithoutNullStreams
      },
    )

    const resultPromise = supervisor.start()
    await Promise.resolve()

    fakeProcess.stdout.write('[Server thread/INFO]: Done (1.234s)! For help, type "help"\n')

    await expect(resultPromise).resolves.toMatchObject({
      ok: true,
      snapshot: {
        state: 'running',
      },
    })
    expect(spawnCalls).toEqual([{ args: [], command: '/tmp/minecraft/launch.sh' }])
  })

  it('marks the server crashed when it exits while starting', async () => {
    const fakeProcess = new FakeMinecraftProcess()
    const supervisor = new MinecraftSupervisor(
      processConfig,
      () => new FakeRconPort(),
      logger,
      () => fakeProcess as unknown as ChildProcessWithoutNullStreams,
    )

    const resultPromise = supervisor.start()
    await Promise.resolve()

    fakeProcess.emit('exit', 1, null)

    await expect(resultPromise).resolves.toMatchObject({
      ok: false,
      snapshot: {
        state: 'crashed',
      },
    })
  })

  it('uses RCON stop before considering the process stopped', async () => {
    const fakeProcess = new FakeMinecraftProcess()
    const fakeRcon = new FakeRconPort(() => {
      fakeProcess.emit('exit', 0, null)
    })
    const supervisor = new MinecraftSupervisor(
      processConfig,
      () => fakeRcon,
      logger,
      () => fakeProcess as unknown as ChildProcessWithoutNullStreams,
    )

    const startPromise = supervisor.start()
    await Promise.resolve()
    fakeProcess.stdout.write('[Server thread/INFO]: Done (1.234s)! For help, type "help"\n')
    await startPromise

    await expect(supervisor.stop(false)).resolves.toMatchObject({
      ok: true,
      snapshot: {
        state: 'stopped',
      },
    })
    expect(fakeRcon.commands).toEqual(['stop'])
  })

  it('emits lifecycle events when the server starts and stops', async () => {
    const fakeProcess = new FakeMinecraftProcess()
    const supervisor = new MinecraftSupervisor(
      processConfig,
      () =>
        new FakeRconPort(() => {
          fakeProcess.emit('exit', 0, null)
        }),
      logger,
      () => fakeProcess as unknown as ChildProcessWithoutNullStreams,
    )
    const events: string[] = []

    supervisor.onLifecycleEvent((event) => {
      events.push(event.kind)
    })

    const startPromise = supervisor.start()
    await Promise.resolve()
    fakeProcess.stdout.write('[Server thread/INFO]: Done (1.234s)! For help, type "help"\n')
    await startPromise
    await supervisor.stop(false)

    expect(events).toEqual(['started', 'stopped'])
  })

  it('emits a crashed lifecycle event when the process exits unexpectedly', async () => {
    const fakeProcess = new FakeMinecraftProcess()
    const supervisor = new MinecraftSupervisor(
      processConfig,
      () => new FakeRconPort(),
      logger,
      () => fakeProcess as unknown as ChildProcessWithoutNullStreams,
    )
    const events: string[] = []

    supervisor.onLifecycleEvent((event) => {
      events.push(event.kind)
    })

    const resultPromise = supervisor.start()
    await Promise.resolve()

    fakeProcess.emit('exit', 1, null)

    await resultPromise
    expect(events).toEqual(['crashed'])
  })
})
