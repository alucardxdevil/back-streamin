import './config/loadEnv.js'
import express from 'express'
import mongoose from 'mongoose'
import cookieParser from 'cookie-parser'
import compression from 'compression'
import helmet from 'helmet'
import userRoute from './routes/users.js'
import videoRoute from './routes/videos.js'
import commentRoute from './routes/comments.js'
import authRoute from './routes/auth.js'
import uploadRoute from './routes/upload.js'
import transcodeRoute from './routes/transcode.js'
import streamRoute from './routes/stream.js'
import sitemapRoute from './routes/sitemap.js'
import ogRoute from './routes/oembed.js'
import panelRoute from './routes/panel.js'
import cors from 'cors'
import logger from './config/logger.js'
import { validateSecretsOnStartup } from './utils/secrets.js'
import { getAllowedOrigins } from './config/allowedOrigins.js'
import { csrfProtection } from './middleware/csrfProtection.js'
import { startViewFlusher } from './services/viewCounter.js'

validateSecretsOnStartup()

const app = express()

mongoose.set('strictQuery', true)
const connect = () => {
    // Opciones de pool y timeouts explícitos:
    //  - maxPoolSize: límite de conexiones concurrentes al cluster (evita
    //    agotar conexiones de Atlas bajo carga).
    //  - serverSelectionTimeoutMS: falla rápido (5s) si el cluster no responde
    //    en lugar de colgar la request hasta el default de 30s.
    //  - socketTimeoutMS: corta sockets inactivos/colgados.
    mongoose.connect(process.env.DB_URI, {
        maxPoolSize: parseInt(process.env.MONGO_MAX_POOL_SIZE) || 20,
        minPoolSize: parseInt(process.env.MONGO_MIN_POOL_SIZE) || 2,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
    }).then(() => {
        logger.info('Conectado a MongoDB')
        console.log('Connect to DB')
    })
    .catch((err) => {
        logger.error('Error conectando a MongoDB', { error: err.message })
        throw err
    })
}

// ── Configuración de Helmet (Security Headers) ───────────────────────────────────
// Helmet establece headers de seguridad HTTP para proteger contra ataques comunes
const helmetConfig = {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdn.jsdelivr.net"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:", "blob:"],
      mediaSrc: ["'self'", "https:", "blob:"],
      frameSrc: ["'self'", "https://www.youtube.com", "https://player.vimeo.com"],
      connectSrc: ["'self'", "https:", "wss:"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false, // Desactivado para permitir embedding de contenido
  crossOriginResourcePolicy: { policy: "cross-origin" },
}

app.use(helmet(helmetConfig))

// Confiar en el primer proxy (Nginx/Cloudflare) para obtener la IP real vía
// X-Forwarded-For. Debe ir ANTES de cualquier middleware que lea req.ip
// (rate limiter, logger, validación de origen) para que vean la IP correcta.
app.set('trust proxy', 1)

// ── Compresión de respuestas ─────────────────────────────────────────────────
// Comprime JSON/HTML/CSS/JS de la API. Excluimos explícitamente los streams de
// video (.m3u8 y .ts): ya vienen empaquetados, recomprimirlos gasta CPU sin
// ganancia y puede romper el pipe del proxy de streaming.
app.use(compression({
  filter: (req, res) => {
    const type = res.getHeader('Content-Type')
    if (typeof type === 'string') {
      if (
        type.includes('mpegurl') ||
        type.includes('video/') ||
        type.includes('mp2t')
      ) {
        return false
      }
    }
    return compression.filter(req, res)
  },
}))

// ── Configuración de CORS ──────────────────────────────────────────────────────
const isProduction = process.env.NODE_ENV === 'production'
const allowedOrigins = getAllowedOrigins()

const corsOptions = {
  origin: (origin, callback) => {
    // En producción, rechazar peticiones sin Origin (excepto health checks internos)
    if (!origin) {
      if (isProduction) {
        return callback(null, false)
      }
      return callback(null, true)
    }

    // En desarrollo, permitir todo
    if (!isProduction) {
      return callback(null, true)
    }

    // En producción, validar contra el array de .env
    if (allowedOrigins.includes(origin)) {
      return callback(null, true)
    } else {
      logger.warn('CORS bloqueado', { origin })
      return callback(null, false)
    }
  },
  credentials: true, // VITAL: Mantiene la conexión de cookies abierta
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Session-Token',
    'X-CSRF-Token',
    'X-Requested-With',
    'Range',
    'X-Stream-Panel-Key',
  ],
  exposedHeaders: ['Content-Range', 'Accept-Ranges', 'Content-Length'],
  // Cachear respuestas preflight (OPTIONS) por 1 hora.
  // CRÍTICO para Firefox: sin esto, Firefox envía un preflight para CADA request
  // con header X-Session-Token (usado por hls.js en cada segmento .ts).
  // Con maxAge, el navegador cachea la respuesta preflight y no la repite.
  maxAge: 3600,
}

// IMPORTANTE: manejar preflight explícitamente en todas las rutas
app.options('*', cors(corsOptions))
app.use(cors(corsOptions))

// ── Middlewares globales ───────────────────────────────────────────────────────
app.use(cookieParser())
app.use(express.json({ limit: '100kb' })) // Limitar tamaño del body para prevenir DoS
app.use(express.urlencoded({ extended: true, limit: '100kb' }))

// Protección CSRF en mutaciones (POST/PUT/DELETE) — excluye stream, panel, móvil Bearer-only
app.use(csrfProtection)

// ── Rutas de la API ────────────────────────────────────────────────────────────
app.use('/api/panel', panelRoute)
app.use('/api/users', userRoute)
app.use('/api/videos', videoRoute)
app.use('/api/comments', commentRoute)
app.use('/api/auth', authRoute)
app.use('/api/upload', uploadRoute)
app.use('/api/transcode', transcodeRoute)

// ── Sistema de Protección de Video (nuevas rutas) ─────────────────────────────
// Handler explícito para OPTIONS preflight en rutas de streaming.
// CRÍTICO para Firefox: hls.js envía el header X-Session-Token en cada request,
// lo que fuerza un preflight CORS. Sin este handler, el preflight puede pasar
// al router y ser rechazado por validateOrigin/requireSessionToken.
app.options('/api/stream/*', cors(corsOptions))

// Todas las rutas de /api/stream están protegidas por múltiples capas de seguridad
app.use('/api/stream', streamRoute)

// ── SEO: Sitemap dinámico ─────────────────────────────────────────────────────
// Accesible en /sitemap.xml (sin prefijo /api para que los crawlers lo encuentren)
app.use('/', sitemapRoute)

// ── SEO: Open Graph meta tags para crawlers ───────────────────────────────────
// Genera HTML con meta tags OG/Twitter para que los crawlers de redes sociales
// puedan leer las miniaturas, títulos y descripciones de videos y perfiles.
// El Cloudflare Worker del frontend redirige crawlers aquí.
app.use('/api/og', ogRoute)

// ── Manejo de errores ─────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
    if (err?.code === 11000) {
        const keyPattern = err.keyPattern || {}
        const field = Object.keys(keyPattern)[0] || 'field'
        const messages = {
            name: 'This username is already taken. Please choose another one.',
            email: 'An account with this email already exists. Try signing in instead.',
            slug: 'This username is already taken. Please choose another one.',
            googleId: 'This Google account is already linked to another user.',
        }
        return res.status(409).json({
            success: false,
            message: messages[field] || 'Duplicate value already exists.',
            field,
        })
    }

    const status = err.status || 500
    const message = err.message || 'Error server'
    try {
        logger.error('Error no manejado', { status, message, path: req.path })
    } catch {
        console.error('[Error handler] Error al loguear:', message)
    }
    return res.status(status).json({
        success: false,
        status,
        message
    })
})

const PORT = process.env.PORT || 5000

app.get('/health', (req, res) => {
    res.status(200).json({ status: 'OK' });
});

app.listen(PORT,  () => {
    connect()
    // Buffer de vistas en Redis → flush periódico a Mongo (F-14 / N-02).
    startViewFlusher()
    logger.info(`Servidor iniciado en puerto ${PORT}`)
    console.log(`Connected on port ${PORT}`)
})
