import { bootstrap } from './bootstrap'
import { loadConfig, loadEnvFiles } from './config/loadConfig'
import { createLogger } from './infra/logger'

async function main(): Promise<void> {
  loadEnvFiles()
  const config = loadConfig()
  const logger = createLogger(config)
  const client = await bootstrap(config, logger)

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    logger.info({ signal }, 'shutdown signal received')
    client.destroy()
  }

  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
