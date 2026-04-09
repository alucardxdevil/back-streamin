/**
 * Configuración de conexión Redis para BullMQ
 *
 * BullMQ requiere una conexión ioredis dedicada.
 * No reutilizar esta conexión para otras operaciones de Redis.
 */

import IORedis from 'ioredis'
import './loadEnv.js'

const redisConfig = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: parseInt(process.env.REDIS_PORT) || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  db: parseInt(process.env.REDIS_DB) || 0,
  // BullMQ requiere maxRetriesPerRequest: null
  maxRetriesPerRequest: null,
  // Reconexión automática
  retryStrategy: (times) => {
    const delay = Math.min(times * 500, 5000)
    console.log(`[Redis] Reintentando conexión en ${delay}ms (intento ${times})`)
    return delay
  },
  // Timeout de conexión
  connectTimeout: 10000,
  // Mantener conexión viva
  keepAlive: 30000,
}

/**
 * Crea una nueva conexión Redis para BullMQ.
 * BullMQ necesita conexiones separadas para Queue y Worker.
 */
export const createRedisConnection = () => {
  const connection = new IORedis(redisConfig)

  connection.on('connect', () => {
    console.log('[Redis] Conectado exitosamente')
  })

  connection.on('error', (err) => {
    console.error('[Redis] Error de conexión:', err.message)
  })

  connection.on('close', () => {
    console.warn('[Redis] Conexión cerrada')
  })

  return connection
}

export default redisConfig
