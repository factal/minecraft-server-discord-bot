import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { readRecentLogLines } from '../src/app/MinecraftLogService'

describe('readRecentLogLines', () => {
  it('returns the requested number of latest non-empty lines', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'minecraft-log-service-'))
    const logPath = join(directory, 'latest.log')

    try {
      await writeFile(logPath, 'one\n\n two \nthree\nfour\n')

      await expect(readRecentLogLines(logPath, 2)).resolves.toEqual(['three', 'four'])
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  })

  it('returns an empty list when latest.log does not exist yet', async () => {
    await expect(readRecentLogLines('/tmp/does-not-exist/latest.log', 10)).resolves.toEqual([])
  })
})
