import type { FastifyInstance } from 'fastify'

async function healthRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/api/health', async () => {
    return {
      status: 'ok',
      ts: Date.now(),
      env: fastify.config.env,
      model: fastify.config.deepseekModel,
      apiKeyConfigured: !!fastify.config.deepseekApiKey,
      limits: {
        absoluteMaxRounds: fastify.config.absoluteMaxRounds,
        absoluteMaxDurationSec: fastify.config.absoluteMaxDurationSec,
      },
    }
  })

  fastify.get('/api/config/limits', async () => {
    return {
      absoluteMaxRounds: fastify.config.absoluteMaxRounds,
      absoluteMaxDurationSec: fastify.config.absoluteMaxDurationSec,
      defaultModel: fastify.config.deepseekModel,
      cost: {
        inputPerMTok: fastify.config.costInputPerMTok,
        outputPerMTok: fastify.config.costOutputPerMTok,
      },
    }
  })
}

export default healthRoutes
