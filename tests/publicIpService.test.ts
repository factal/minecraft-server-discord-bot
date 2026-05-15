import { describe, expect, it, vi } from 'vitest'

import { PublicIpService } from '../src/app/PublicIpService'
import type { AppConfig } from '../src/config/schema'

const config: AppConfig['minecraft']['publicIp'] = {
  cacheMs: 300000,
  lookupUrl: 'https://example.com/ip',
  timeoutMs: 3000,
}

function response(body: string, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  } as Response
}

describe('PublicIpService', () => {
  it('returns a configured static IP without fetching', async () => {
    const fetchPublicIp = vi.fn()
    const service = new PublicIpService(
      {
        ...config,
        staticIpAddress: '203.0.113.10',
      },
      fetchPublicIp,
    )

    await expect(service.getPublicIp()).resolves.toMatchObject({
      ipAddress: '203.0.113.10',
    })
    expect(fetchPublicIp).not.toHaveBeenCalled()
  })

  it('fetches and caches the public IP', async () => {
    const fetchPublicIp = vi.fn().mockResolvedValue(response('203.0.113.10\n'))
    const service = new PublicIpService(config, fetchPublicIp)

    await expect(service.getPublicIp()).resolves.toMatchObject({
      ipAddress: '203.0.113.10',
    })
    await expect(service.getPublicIp()).resolves.toMatchObject({
      ipAddress: '203.0.113.10',
    })
    expect(fetchPublicIp).toHaveBeenCalledTimes(1)
    expect(fetchPublicIp).toHaveBeenCalledWith('https://example.com/ip', {
      signal: expect.any(AbortSignal),
    })
  })

  it('returns a user-facing error when lookup does not return an IP', async () => {
    const service = new PublicIpService(config, vi.fn().mockResolvedValue(response('not an ip')))

    await expect(service.getPublicIp()).resolves.toMatchObject({
      errorMessage: 'lookup did not return an IP address',
    })
  })
})
