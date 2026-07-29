import type { AppConfig } from './index.js'

/**
 * Fastify 实例装饰器类型扩展
 * index.js 中 fastify.decorate('config', config) 挂载的配置对象。
 */
declare module 'fastify' {
  interface FastifyInstance {
    config: AppConfig
  }
}
