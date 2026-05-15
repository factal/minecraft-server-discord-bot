import { isIP } from 'node:net'

import type { AppConfig } from '../config/schema'

export interface PublicIpStatus {
  checkedAt: Date
  errorMessage?: string
  ipAddress?: string
}

type FetchPublicIp = (url: string, init: { signal: AbortSignal }) => Promise<Response>

export class PublicIpService {
  private cachedStatus: PublicIpStatus | undefined

  constructor(
    private readonly config: AppConfig['minecraft']['publicIp'],
    private readonly fetchPublicIp: FetchPublicIp = fetch,
  ) {}

  async getPublicIp(): Promise<PublicIpStatus> {
    if (this.config.staticIpAddress) {
      return {
        checkedAt: new Date(),
        ipAddress: this.config.staticIpAddress,
      }
    }

    const cachedStatus = this.cachedStatus

    if (
      cachedStatus &&
      cachedStatus.ipAddress &&
      Date.now() - cachedStatus.checkedAt.getTime() < this.config.cacheMs
    ) {
      return cachedStatus
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs)

    try {
      const response = await this.fetchPublicIp(this.config.lookupUrl, {
        signal: controller.signal,
      })

      if (!response.ok) {
        return this.error(`lookup returned HTTP ${response.status}`)
      }

      const ipAddress = (await response.text()).trim()

      if (!isIP(ipAddress)) {
        return this.error('lookup did not return an IP address')
      }

      const status = {
        checkedAt: new Date(),
        ipAddress,
      }

      this.cachedStatus = status

      return status
    } catch (error) {
      return this.error(error instanceof Error ? error.message : 'unknown public IP lookup error')
    } finally {
      clearTimeout(timeout)
    }
  }

  private error(errorMessage: string): PublicIpStatus {
    return {
      checkedAt: new Date(),
      errorMessage,
    }
  }
}
