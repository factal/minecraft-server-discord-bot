export interface RconPort {
  connect(): Promise<void>
  disconnect(): Promise<void>
  send(command: string): Promise<string>
  isConnected(): boolean
}

export interface RconConfig {
  host: string
  port: number
  password: string
  timeoutMs: number
}
