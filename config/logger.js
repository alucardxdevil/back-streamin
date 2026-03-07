/**
 * Sistema de Logging Estructurado — Stream-In
 *
 * Capa de protección: MONITOREO Y AUDITORÍA (Capa 7)
 * Amenaza cubierta: Detección de abuso, scraping masivo, extracción sistemática.
 *
 * Registra cada intento de acceso a video con:
 *  - IP del cliente
 *  - Timestamp ISO 8601
 *  - Recurso solicitado
 *  - Validez del token de sesión
 *  - Valor del header Origin
 *  - Resultado: autorizado o rechazado
 *  - Razón del rechazo (si aplica)
 *
 * Implementación: Logger basado en console con soporte opcional de winston.
 * Para habilitar logging a archivos: npm install winston
 */

import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// ── Crear directorio de logs si no existe ─────────────────────────────────────
const logsDir = path.join(__dirname, '../logs')
try {
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true })
  }
} catch {
  // Ignorar error si no se puede crear el directorio
}

// ── Logger basado en console (siempre disponible) ─────────────────────────────
const consoleLogger = {
  info: (msg, meta) => {
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[INFO] ${msg}`, meta ? JSON.stringify(meta) : '')
    }
  },
  warn: (msg, meta) => console.warn(`[WARN] ${msg}`, meta ? JSON.stringify(meta) : ''),
  error: (msg, meta) => console.error(`[ERROR] ${msg}`, meta ? JSON.stringify(meta) : ''),
  debug: (msg, meta) => {
    if (process.env.NODE_ENV !== 'production') {
      console.debug(`[DEBUG] ${msg}`, meta ? JSON.stringify(meta) : '')
    }
  },
}

// ── Intentar cargar winston de forma asíncrona (no bloquea el arranque) ───────
// Winston se carga después del arranque para no interferir con la inicialización
let activeLogger = consoleLogger

const loadWinston = async () => {
  try {
    const winston = await import('winston')
    const { createLogger, format, transports } = winston

    const { combine, timestamp, json, printf, errors } = format

    const consoleFormat = printf(({ level, message, timestamp, ...meta }) => {
      const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : ''
      return `[${timestamp}] ${level.toUpperCase()}: ${message}${metaStr}`
    })

    const fileFormat = combine(
      timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }),
      errors({ stack: true }),
      json()
    )

    const logTransports = [
      new transports.Console({
        format: combine(
          timestamp({ format: 'HH:mm:ss' }),
          consoleFormat
        ),
        level: process.env.NODE_ENV === 'production' ? 'warn' : 'debug',
      }),
    ]

    if (process.env.NODE_ENV === 'production') {
      logTransports.push(
        new transports.File({
          filename: path.join(logsDir, 'app.log'),
          format: fileFormat,
          level: 'info',
          maxsize: 20 * 1024 * 1024,
          maxFiles: 14,
          tailable: true,
        }),
        new transports.File({
          filename: path.join(logsDir, 'video-access.log'),
          format: fileFormat,
          level: 'info',
          maxsize: 50 * 1024 * 1024,
          maxFiles: 30,
          tailable: true,
        })
      )
    }

    const winstonLogger = createLogger({
      level: process.env.LOG_LEVEL || 'info',
      format: fileFormat,
      transports: logTransports,
      exitOnError: false,
    })

    // Reemplazar el logger activo con winston
    activeLogger = winstonLogger
    console.log('[Logger] Winston cargado correctamente')
  } catch {
    // Winston no está instalado — continuar con console
    console.log('[Logger] Winston no disponible — usando console. Instalar con: npm install winston')
  }
}

// Cargar winston de forma no bloqueante
loadWinston()

// ── Proxy del logger (siempre usa el logger activo) ───────────────────────────
export const logger = {
  info: (msg, meta) => activeLogger.info(msg, meta),
  warn: (msg, meta) => activeLogger.warn(msg, meta),
  error: (msg, meta) => activeLogger.error(msg, meta),
  debug: (msg, meta) => activeLogger.debug(msg, meta),
}

/**
 * Registra un intento de acceso a video.
 */
export const logVideoAccess = ({
  ip,
  resource,
  authorized,
  reason = null,
  origin = null,
  referer = null,
  tokenValid = false,
  sessionId = null,
  userAgent = null,
  statusCode = null,
}) => {
  const entry = {
    event: 'video_access',
    ip,
    resource,
    authorized,
    reason,
    origin,
    referer,
    tokenValid,
    sessionId,
    userAgent,
    statusCode,
    timestamp: new Date().toISOString(),
  }

  if (authorized) {
    logger.info('Video access granted', entry)
  } else {
    logger.warn('Video access denied', entry)
  }
}

/**
 * Registra un evento de rate limiting.
 */
export const logRateLimit = ({ ip, endpoint, userAgent }) => {
  logger.warn('Rate limit exceeded', {
    event: 'rate_limit',
    ip,
    endpoint,
    userAgent,
    timestamp: new Date().toISOString(),
  })
}

/**
 * Registra la emisión de un token de sesión anónimo.
 */
export const logSessionIssued = ({ ip, sessionId, userAgent }) => {
  logger.info('Anonymous session issued', {
    event: 'session_issued',
    ip,
    sessionId,
    userAgent,
    timestamp: new Date().toISOString(),
  })
}

export default logger
