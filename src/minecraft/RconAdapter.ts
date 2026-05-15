import { Socket } from 'node:net'

import type { AppLogger } from '../infra/logger'
import type { RconConfig, RconPort } from './RconPort'

const AUTH_PACKET_TYPE = 3
const COMMAND_PACKET_TYPE = 2
const MIN_PACKET_LENGTH = 10
const RESPONSE_IDLE_TIMEOUT_MS = 75

interface RconPacket {
  id: number
  type: number
  payload: string
}

interface PacketWaiter {
  predicate(packet: RconPacket): boolean
  resolve(packet: RconPacket): void
  reject(error: Error): void
  timer: NodeJS.Timeout
}

export class RconError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RconError'
  }
}

export class RconAdapter implements RconPort {
  private buffer = Buffer.alloc(0)
  private nextRequestId = 1
  private packetQueue: RconPacket[] = []
  private socket: Socket | undefined
  private waiters: PacketWaiter[] = []

  constructor(
    private readonly config: RconConfig,
    private readonly logger: AppLogger,
  ) {}

  isConnected(): boolean {
    return Boolean(this.socket && !this.socket.destroyed)
  }

  async connect(): Promise<void> {
    if (this.isConnected()) {
      return
    }

    this.socket = new Socket()
    this.socket.on('data', (chunk: Buffer) => this.onData(chunk))
    this.socket.on('error', (error) => this.rejectWaiters(error))
    this.socket.on('close', () => {
      this.rejectWaiters(new RconError('RCON connection closed.'))
      this.socket = undefined
    })

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new RconError('Timed out while connecting to RCON.'))
        this.socket?.destroy()
      }, this.config.timeoutMs)

      this.socket?.once('connect', () => {
        clearTimeout(timer)
        resolve()
      })

      this.socket?.once('error', (error) => {
        clearTimeout(timer)
        reject(error)
      })

      this.socket?.connect({
        host: this.config.host,
        port: this.config.port,
      })
    })

    await this.authenticate()
    this.logger.debug({ host: this.config.host, port: this.config.port }, 'connected to RCON')
  }

  async disconnect(): Promise<void> {
    const socket = this.socket

    if (!socket) {
      return
    }

    await new Promise<void>((resolve) => {
      socket.once('close', () => resolve())
      socket.end()
      setTimeout(() => {
        if (!socket.destroyed) {
          socket.destroy()
        }
        resolve()
      }, 250).unref()
    })

    this.socket = undefined
  }

  async send(command: string): Promise<string> {
    await this.connect()

    const requestId = this.allocateRequestId()
    this.writePacket({
      id: requestId,
      payload: command,
      type: COMMAND_PACKET_TYPE,
    })

    const packets = [await this.waitForPacket((packet) => packet.id === requestId)]

    while (true) {
      try {
        packets.push(
          await this.waitForPacket((packet) => packet.id === requestId, RESPONSE_IDLE_TIMEOUT_MS),
        )
      } catch (error) {
        if (error instanceof RconError && error.message.includes('Timed out')) {
          break
        }

        throw error
      }
    }

    return packets.map((packet) => packet.payload).join('')
  }

  private async authenticate(): Promise<void> {
    const requestId = this.allocateRequestId()

    this.writePacket({
      id: requestId,
      payload: this.config.password,
      type: AUTH_PACKET_TYPE,
    })

    const response = await this.waitForPacket(
      (packet) => packet.id === requestId || packet.id === -1,
    )

    if (response.id === -1) {
      throw new RconError('RCON authentication failed.')
    }
  }

  private allocateRequestId(): number {
    const requestId = this.nextRequestId
    this.nextRequestId += 1

    if (this.nextRequestId >= 2_147_483_000) {
      this.nextRequestId = 1
    }

    return requestId
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk])

    while (this.buffer.length >= 4) {
      const packetLength = this.buffer.readInt32LE(0)

      if (packetLength < MIN_PACKET_LENGTH) {
        this.rejectWaiters(new RconError(`Invalid RCON packet length: ${packetLength}.`))
        this.socket?.destroy()
        return
      }

      const totalLength = packetLength + 4

      if (this.buffer.length < totalLength) {
        return
      }

      const packet = decodePacket(this.buffer.subarray(4, totalLength))
      this.buffer = this.buffer.subarray(totalLength)
      this.deliverPacket(packet)
    }
  }

  private deliverPacket(packet: RconPacket): void {
    const waiterIndex = this.waiters.findIndex((waiter) => waiter.predicate(packet))

    if (waiterIndex === -1) {
      this.packetQueue.push(packet)
      return
    }

    const waiter = this.waiters[waiterIndex]

    if (!waiter) {
      this.packetQueue.push(packet)
      return
    }

    this.waiters.splice(waiterIndex, 1)
    clearTimeout(waiter.timer)
    waiter.resolve(packet)
  }

  private waitForPacket(
    predicate: (packet: RconPacket) => boolean,
    timeoutMs = this.config.timeoutMs,
  ): Promise<RconPacket> {
    const queuedPacketIndex = this.packetQueue.findIndex(predicate)

    if (queuedPacketIndex !== -1) {
      const queuedPacket = this.packetQueue[queuedPacketIndex]

      if (!queuedPacket) {
        return Promise.reject(new RconError('RCON packet queue was unexpectedly empty.'))
      }

      this.packetQueue.splice(queuedPacketIndex, 1)
      return Promise.resolve(queuedPacket)
    }

    return new Promise<RconPacket>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((waiter) => waiter.timer !== timer)
        reject(new RconError('Timed out while waiting for RCON response.'))
      }, timeoutMs)

      this.waiters.push({
        predicate,
        reject,
        resolve,
        timer,
      })
    })
  }

  private rejectWaiters(error: Error): void {
    const waiters = this.waiters
    this.waiters = []

    for (const waiter of waiters) {
      clearTimeout(waiter.timer)
      waiter.reject(error)
    }
  }

  private writePacket(packet: RconPacket): void {
    if (!this.socket || this.socket.destroyed) {
      throw new RconError('RCON socket is not connected.')
    }

    this.socket.write(encodePacket(packet))
  }
}

function encodePacket(packet: RconPacket): Buffer {
  const payload = Buffer.from(packet.payload, 'utf8')
  const packetLength = payload.length + 10
  const buffer = Buffer.alloc(packetLength + 4)

  buffer.writeInt32LE(packetLength, 0)
  buffer.writeInt32LE(packet.id, 4)
  buffer.writeInt32LE(packet.type, 8)
  payload.copy(buffer, 12)
  buffer.writeUInt8(0, packetLength + 2)
  buffer.writeUInt8(0, packetLength + 3)

  return buffer
}

function decodePacket(body: Buffer): RconPacket {
  const payload = body.subarray(8, body.length - 2).toString('utf8')

  return {
    id: body.readInt32LE(0),
    payload,
    type: body.readInt32LE(4),
  }
}
