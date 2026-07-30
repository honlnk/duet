import type { FastifyInstance } from 'fastify'
import { listProviderItems } from '../store/providerStore.js'

async function healthRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/api/health', async () => {
    const providers = listProviderItems()
    return {
      status: 'ok',
      ts: Date.now(),
      env: fastify.config.env,
      providerCount: providers.providers.length,
      hasDefaultProvider: !!providers.defaultId,
      limits: {
        absoluteMaxRounds: fastify.config.absoluteMaxRounds,
        absoluteMaxDurationSec: fastify.config.absoluteMaxDurationSec,
      },
    }
  })

  fastify.get('/api/config/limits', async () => {
    const providers = listProviderItems()
    return {
      absoluteMaxRounds: fastify.config.absoluteMaxRounds,
      absoluteMaxDurationSec: fastify.config.absoluteMaxDurationSec,
      defaultProviderId: providers.defaultId,
    }
  })
}

export default healthRoutes
