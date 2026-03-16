import express from 'express'
import mongoose from 'mongoose'
import dotenv from 'dotenv'
import cookieParser from 'cookie-parser'
import userRoute from './routes/users.js'
import videoRoute from './routes/videos.js'
import commentRoute from './routes/comments.js'
import authRoute from './routes/auth.js'
import uploadRoute from './routes/upload.js'
import transcodeRoute from './routes/transcode.js'
import streamRoute from './routes/stream.js'
import cors from 'cors'
import logger from './config/logger.js'

const app = express()
dotenv.config()

mongoose.set('strictQuery', false)
const connect = () => {
    mongoose.connect(process.env.DB_URI).then(() => {
        logger.info('Conectado a MongoDB')
        console.log('Connect to DB')
    })
    .catch((err) => {
        logger.error('Error conectando a MongoDB', { error: err.message })
        throw err
    })
}

// ── Configuración de CORS ──────────────────────────────────────────────────────
// Permite solicitudes desde los dominios autorizados de la aplicación
const isProduction = process.env.NODE_ENV === 'production'

const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean)

// En desarrollo, agregar localhost por defecto
if (!isProduction) {
  allowedOrigins.push(
    'http://localhost:3000',
    'http://localhost:5000',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:5000'
  )
}

app.use(cors({
  origin: (origin, callback) => {
    // En desarrollo, ser permisivo para facilitar el desarrollo local
    if (!isProduction) {
      return callback(null, true)
    }
    // En producción: verificar origin estrictamente
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true)
    }
    logger.warn('CORS bloqueado', { origin })
    const corsError = new Error('No permitido por CORS')
    corsError.status = 403
    callback(corsError)
  },
  origin: allowedOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Session-Token', 'Range'],
}))

// ── Middlewares globales ───────────────────────────────────────────────────────
app.use(cookieParser())
app.use(express.json())

// Confiar en el primer proxy (para obtener IP real con X-Forwarded-For)
// Necesario para rate limiting correcto detrás de Nginx/Cloudflare
app.set('trust proxy', 1)

// ── Rutas de la API ────────────────────────────────────────────────────────────
app.use('/api/users', userRoute)
app.use('/api/videos', videoRoute)
app.use('/api/comments', commentRoute)
app.use('/api/auth', authRoute)
app.use('/api/upload', uploadRoute)
app.use('/api/transcode', transcodeRoute)

// ── Sistema de Protección de Video (nuevas rutas) ─────────────────────────────
// Todas las rutas de /api/stream están protegidas por múltiples capas de seguridad
app.use('/api/stream', streamRoute)

// ── Manejo de errores ─────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
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
    logger.info(`Servidor iniciado en puerto ${PORT}`)
    console.log(`Connected on port ${PORT}`)
})
