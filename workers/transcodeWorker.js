/**
 * Worker de Transcodificación HLS
 *
 * Este proceso corre de forma INDEPENDIENTE al servidor Express.
 * Iniciar con: node server/workers/transcodeWorker.js
 *
 * Responsabilidades:
 *  1. Descargar MP4 original desde Backblaze B2
 *  2. Detectar resolución original con ffprobe
 *  3. Filtrar perfiles dinámicamente (nunca escalar hacia arriba)
 *  4. Transcodificar con FFmpeg a HLS multi-bitrate (CRF + perfiles adaptativos)
 *  5. Subir todos los segmentos HLS a B2
 *  6. Eliminar el MP4 original de B2 (ahorro de storage)
 *  7. Limpiar archivos temporales del disco local
 *  8. Actualizar el documento Video en MongoDB
 *
 * Optimizaciones de recursos:
 *  - Descarga MP4 a /tmp/ (no en RAM)
 *  - Upload HLS con streams (no carga todo en RAM)
 *  - Limpieza garantizada de /tmp/ incluso en caso de error
 *  - Concurrencia configurable via WORKER_CONCURRENCY
 *  - CRF para mejor compresión sin sacrificar calidad
 *  - No upscale: solo genera perfiles ≤ resolución original
 */

import { Worker } from 'bullmq'
import mongoose from 'mongoose'
import { spawn } from 'child_process'
import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3'
import { createReadStream, createWriteStream } from 'fs'
import { mkdir, rm, readdir, stat } from 'fs/promises'
import { join, extname } from 'path'
import { pipeline } from 'stream/promises'
import dotenv from 'dotenv'
import { createRedisConnection } from '../config/redis.js'
import { QUEUE_NAME } from '../queues/transcodeQueue.js'

dotenv.config({ path: new URL('../../.env', import.meta.url).pathname })

// ─── Configuración FFmpeg / FFprobe ───────────────────────────────────────────
const ffmpegPath = process.env.FFMPEG_PATH || '/usr/bin/ffmpeg'
const ffprobePath = process.env.FFPROBE_PATH || '/usr/bin/ffprobe'
console.log(`[Worker] FFmpeg path: ${ffmpegPath}`)
console.log(`[Worker] FFprobe path: ${ffprobePath}`)

// ─── Configuración B2 ─────────────────────────────────────────────────────────
const s3 = new S3Client({
  endpoint: process.env.B2_ENDPOINT,
  region: process.env.B2_REGION,
  credentials: {
    accessKeyId: process.env.B2_KEY_ID,
    secretAccessKey: process.env.B2_APP_KEY,
  },
  forcePathStyle: true,
  requestChecksumCalculation: 'WHEN_REQUIRED',
})

const B2_BUCKET = process.env.B2_BUCKET_NAME
const HLS_BASE_URL = process.env.HLS_BASE_URL || process.env.B2_PUBLIC_URL

// ─── Directorio temporal ──────────────────────────────────────────────────────
const TEMP_DIR = process.env.TEMP_DIR || '/tmp/transcode'

// ─── Catálogo completo de perfiles HLS ────────────────────────────────────────
/**
 * Cada perfil define:
 *  - name: nombre del directorio y etiqueta
 *  - width/height: resolución máxima (se filtra dinámicamente)
 *  - crf: Constant Rate Factor (menor = mejor calidad, mayor archivo)
 *  - maxRate: bitrate máximo para VBR cap
 *  - bufSize: tamaño del buffer (2x maxRate aprox)
 *  - audioBitrate: bitrate de audio
 *  - bandwidth: valor para el master.m3u8 (en bps, estimado)
 *
 * Ordenados de mayor a menor resolución.
 * getProfilesForInput() filtra solo los que aplican.
 */
const ALL_PROFILES = [
  {
    name: '1080p',
    width: 1920,
    height: 1080,
    crf: 23,
    maxRate: '4000k',
    bufSize: '8000k',
    audioBitrate: '128k',
    bandwidth: 4128000,
  },
  {
    name: '720p',
    width: 1280,
    height: 720,
    crf: 23,
    maxRate: '2500k',
    bufSize: '5000k',
    audioBitrate: '128k',
    bandwidth: 2628000,
  },
  {
    name: '480p',
    width: 854,
    height: 480,
    crf: 23,
    maxRate: '1000k',
    bufSize: '2000k',
    audioBitrate: '96k',
    bandwidth: 1096000,
  },
  {
    name: '360p',
    width: 640,
    height: 360,
    crf: 23,
    maxRate: '600k',
    bufSize: '1200k',
    audioBitrate: '96k',
    bandwidth: 696000,
  },
  {
    name: '240p',
    width: 426,
    height: 240,
    crf: 23,
    maxRate: '400k',
    bufSize: '800k',
    audioBitrate: '64k',
    bandwidth: 464000,
  },
]

// ─── Detección de resolución con ffprobe ──────────────────────────────────────

/**
 * Ejecuta ffprobe para obtener width y height del video de entrada.
 *
 * @param {string} inputPath - Ruta local del archivo de video
 * @returns {Promise<{width: number, height: number}>}
 */
const probeResolution = (inputPath) => {
  return new Promise((resolve, reject) => {
    const args = [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height',
      '-of', 'json',
      inputPath,
    ]

    const proc = spawn(ffprobePath, args, { stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (data) => { stdout += data.toString() })
    proc.stderr.on('data', (data) => { stderr += data.toString() })

    proc.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`ffprobe terminó con código ${code}: ${stderr}`))
      }
      try {
        const info = JSON.parse(stdout)
        const stream = info.streams?.[0]
        if (!stream || !stream.width || !stream.height) {
          return reject(new Error('ffprobe no devolvió resolución válida'))
        }
        resolve({ width: stream.width, height: stream.height })
      } catch (e) {
        reject(new Error(`Error parseando salida de ffprobe: ${e.message}`))
      }
    })

    proc.on('error', (err) => {
      reject(new Error(`No se pudo iniciar ffprobe: ${err.message}`))
    })
  })
}

// ─── Filtrado dinámico de perfiles ────────────────────────────────────────────

/**
 * Devuelve solo los perfiles cuya resolución sea MENOR o IGUAL
 * a la resolución original del video. Usa el lado mayor (max(w,h))
 * para soportar videos verticales y horizontales.
 *
 * Siempre devuelve al menos el perfil más bajo (240p).
 *
 * @param {number} inputWidth  - Ancho original del video
 * @param {number} inputHeight - Alto original del video
 * @returns {Array} Perfiles filtrados
 */
const getProfilesForInput = (inputWidth, inputHeight) => {
  // Usar el lado mayor para comparar (soporta vertical y horizontal)
  const inputMax = Math.max(inputWidth, inputHeight)
  const inputMin = Math.min(inputWidth, inputHeight)

  const filtered = ALL_PROFILES.filter((profile) => {
    // Comparar el lado mayor del perfil con el lado mayor del input
    const profileMax = Math.max(profile.width, profile.height)
    return profileMax <= inputMax
  })

  // Siempre incluir al menos 240p como mínimo
  if (filtered.length === 0) {
    const lowest = ALL_PROFILES[ALL_PROFILES.length - 1] // 240p
    return [lowest]
  }

  return filtered
}

// ─── Conexión MongoDB ─────────────────────────────────────────────────────────
let mongoConnected = false

const connectMongo = async () => {
  if (mongoConnected) return
  await mongoose.connect(process.env.DB_URI)
  mongoConnected = true
  console.log('[Worker] MongoDB conectado')
}

// ─── Utilidades ───────────────────────────────────────────────────────────────

/**
 * Descarga un archivo de B2 al disco local.
 * Usa streams para no cargar el archivo en RAM.
 *
 * @param {string} key       - Key del archivo en B2
 * @param {string} destPath  - Ruta local de destino
 */
const downloadFromB2 = async (key, destPath) => {
  console.log(`[Worker] Descargando ${key} → ${destPath}`)

  const command = new GetObjectCommand({ Bucket: B2_BUCKET, Key: key })
  const response = await s3.send(command)

  const writeStream = createWriteStream(destPath)
  await pipeline(response.Body, writeStream)

  const fileStat = await stat(destPath)
  console.log(`[Worker] Descarga completa: ${(fileStat.size / 1024 / 1024).toFixed(2)} MB`)
}

/**
 * Sube un archivo local a B2 usando streams.
 * No carga el archivo completo en RAM.
 *
 * @param {string} localPath   - Ruta local del archivo
 * @param {string} b2Key       - Key de destino en B2
 * @param {string} contentType - MIME type del archivo
 */
const uploadToB2 = async (localPath, b2Key, contentType) => {
  const readStream = createReadStream(localPath)
  const fileStat = await stat(localPath)

  await s3.send(
    new PutObjectCommand({
      Bucket: B2_BUCKET,
      Key: b2Key,
      Body: readStream,
      ContentType: contentType,
      ContentLength: fileStat.size,
    })
  )
}

/**
 * Elimina un archivo de B2.
 *
 * @param {string} key - Key del archivo a eliminar
 */
const deleteFromB2 = async (key) => {
  await s3.send(new DeleteObjectCommand({ Bucket: B2_BUCKET, Key: key }))
  console.log(`[Worker] Eliminado de B2: ${key}`)
}

/**
 * Elimina todos los objetos bajo un prefijo en B2.
 * Útil para limpiar un directorio HLS fallido.
 *
 * @param {string} prefix - Prefijo a eliminar (ej: hls/{videoId}/)
 */
const deleteB2Prefix = async (prefix) => {
  let continuationToken = undefined

  do {
    const listCommand = new ListObjectsV2Command({
      Bucket: B2_BUCKET,
      Prefix: prefix,
      ContinuationToken: continuationToken,
    })

    const listResponse = await s3.send(listCommand)

    if (listResponse.Contents && listResponse.Contents.length > 0) {
      await Promise.all(
        listResponse.Contents.map((obj) => deleteFromB2(obj.Key))
      )
    }

    continuationToken = listResponse.NextContinuationToken
  } while (continuationToken)
}

/**
 * Transcodifica el video con FFmpeg a HLS multi-bitrate.
 * Usa CRF para mejor compresión, con maxrate cap.
 * Filtra perfiles dinámicamente según resolución del input.
 * Usa scale='min(W,iw)':-2 para evitar upscale.
 *
 * @param {string} inputPath  - Ruta del MP4 de entrada
 * @param {string} outputDir  - Directorio de salida para los segmentos HLS
 * @param {Array}  profiles   - Perfiles filtrados para este video
 * @param {Function} onProgress - Callback de progreso (0-100)
 * @returns {Promise<number>} - Duración del video en segundos
 */
const transcodeToHLS = (inputPath, outputDir, profiles, onProgress) => {
  return new Promise((resolve, reject) => {
    let duration = 0

    // ── Construir array de argumentos para FFmpeg ──────────────────────────
    const args = [
      '-hide_banner',
      '-loglevel', 'info',
      '-progress', 'pipe:1',       // Enviar progreso a stdout
      '-i', inputPath,
    ]

    // Agregar -map por cada perfil de calidad
    profiles.forEach(() => {
      args.push(
        '-map', '0:v:0',           // Mapear primer stream de video
        '-map', '0:a:0',           // Mapear primer stream de audio
      )
    })

    // Opciones de codec por perfil (CRF + maxrate cap)
    profiles.forEach((profile, index) => {
      args.push(
        `-c:v:${index}`, 'libx264',
        `-crf:v:${index}`, `${profile.crf}`,
        `-maxrate:v:${index}`, profile.maxRate,
        `-bufsize:v:${index}`, profile.bufSize,
        `-filter:v:${index}`, `scale='min(${profile.width},iw)':-2`,
        `-c:a:${index}`, 'aac',
        `-b:a:${index}`, profile.audioBitrate,
      )
    })

    // Opciones globales de optimización
    args.push(
      '-preset', 'medium',
      '-profile:v', 'main',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      '-g', '48',
      '-sc_threshold', '0',
      '-keyint_min', '48',
    )

    // Configuración HLS
    const varStreamMap = profiles.map((p, i) => `v:${i},a:${i},name:${p.name}`).join(' ')

    args.push(
      '-f', 'hls',
      '-hls_time', '6',
      '-hls_playlist_type', 'vod',
      '-hls_flags', 'independent_segments',
      '-hls_segment_type', 'mpegts',
      '-hls_segment_filename', `${outputDir}/%v/seg%03d.ts`,
      '-master_pl_name', 'master.m3u8',
      '-var_stream_map', varStreamMap,
      `${outputDir}/%v/stream.m3u8`,
    )

    console.log('[FFmpeg] Iniciando transcodificación')
    console.log(`[FFmpeg] Perfiles: ${profiles.map(p => p.name).join(', ')}`)
    console.log('[FFmpeg] Comando:', ffmpegPath, args.join(' ').substring(0, 400) + '...')

    // ── Ejecutar FFmpeg con spawn ──────────────────────────────────────────
    const proc = spawn(ffmpegPath, args, { stdio: ['pipe', 'pipe', 'pipe'] })

    let stderrOutput = ''

    // Parsear progreso desde stdout (-progress pipe:1)
    proc.stdout.on('data', (data) => {
      const text = data.toString()

      // Extraer duración total del video
      const durationMatch = text.match(/duration=(\d+:\d+:\d+\.\d+)/)
      if (durationMatch) {
        const parts = durationMatch[1].split(':')
        duration = parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseFloat(parts[2])
      }

      // Extraer tiempo actual procesado
      const outTimeMatch = text.match(/out_time_us=(\d+)/)
      if (outTimeMatch && duration > 0) {
        const currentSeconds = parseInt(outTimeMatch[1]) / 1000000
        const percent = Math.min(Math.round((currentSeconds / duration) * 100), 95)
        onProgress(percent)
      }

      // Detectar progreso=end
      if (text.includes('progress=end')) {
        onProgress(95)
      }
    })

    // Capturar stderr para diagnóstico
    proc.stderr.on('data', (data) => {
      const text = data.toString()
      stderrOutput += text

      // Extraer duración del input desde stderr (línea "Duration: HH:MM:SS.xx")
      const durMatch = text.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/)
      if (durMatch && duration === 0) {
        duration = parseInt(durMatch[1]) * 3600 + parseInt(durMatch[2]) * 60 + parseFloat(durMatch[3])
        console.log(`[FFmpeg] Duración detectada: ${duration}s`)
      }

      // Mostrar líneas de warning/error
      if (text.includes('Error') || text.includes('error') || text.includes('Warning')) {
        console.log(`[FFmpeg] stderr: ${text.trim().substring(0, 200)}`)
      }
    })

    proc.on('close', (code) => {
      if (code === 0) {
        console.log('[FFmpeg] Transcodificación completada exitosamente')
        resolve(duration)
      } else {
        console.error(`[FFmpeg] Proceso terminó con código ${code}`)
        console.error('[FFmpeg] Últimas líneas stderr:', stderrOutput.substring(stderrOutput.length - 500))
        reject(new Error(`FFmpeg terminó con código ${code}`))
      }
    })

    proc.on('error', (err) => {
      console.error('[FFmpeg] Error al iniciar proceso:', err.message)
      reject(new Error(`No se pudo iniciar FFmpeg: ${err.message}`))
    })
  })
}

/**
 * Sube todos los archivos HLS de un directorio a B2.
 * Sube en paralelo con límite de concurrencia para no saturar la red.
 *
 * @param {string} localDir  - Directorio local con los archivos HLS
 * @param {string} b2Prefix  - Prefijo en B2 (ej: hls/{videoId}/)
 * @param {Array}  profiles  - Perfiles usados en esta transcodificación
 */
const uploadHLSToB2 = async (localDir, b2Prefix, profiles) => {
  const UPLOAD_CONCURRENCY = 5 // Subir 5 archivos simultáneamente

  // Recopilar todos los archivos a subir
  const filesToUpload = []

  // master.m3u8
  filesToUpload.push({
    localPath: join(localDir, 'master.m3u8'),
    b2Key: `${b2Prefix}master.m3u8`,
    contentType: 'application/vnd.apple.mpegurl',
  })

  // Archivos de cada perfil
  for (const profile of profiles) {
    const profileDir = join(localDir, profile.name)

    try {
      const files = await readdir(profileDir)

      for (const file of files) {
        const ext = extname(file)
        const contentType = ext === '.m3u8'
          ? 'application/vnd.apple.mpegurl'
          : 'video/mp2t'

        filesToUpload.push({
          localPath: join(profileDir, file),
          b2Key: `${b2Prefix}${profile.name}/${file}`,
          contentType,
        })
      }
    } catch (err) {
      console.warn(`[Worker] No se encontró directorio para perfil ${profile.name}:`, err.message)
    }
  }

  console.log(`[Worker] Subiendo ${filesToUpload.length} archivos HLS a B2...`)

  // Subir en lotes para controlar concurrencia
  for (let i = 0; i < filesToUpload.length; i += UPLOAD_CONCURRENCY) {
    const batch = filesToUpload.slice(i, i + UPLOAD_CONCURRENCY)
    await Promise.all(
      batch.map(({ localPath, b2Key, contentType }) =>
        uploadToB2(localPath, b2Key, contentType)
      )
    )
    console.log(`[Worker] Subidos ${Math.min(i + UPLOAD_CONCURRENCY, filesToUpload.length)}/${filesToUpload.length}`)
  }

  console.log('[Worker] Upload HLS completado')
  return filesToUpload.length
}

// ─── Procesador del Job ───────────────────────────────────────────────────────

/**
 * Función principal que procesa cada job de transcodificación.
 *
 * @param {Job} job - Job de BullMQ con { videoId, rawKey, userId }
 */
const processTranscodeJob = async (job) => {
  const { videoId, rawKey, userId } = job.data
  const jobDir = join(TEMP_DIR, job.id)
  const inputPath = join(jobDir, 'input.mp4')
  const outputDir = join(jobDir, 'output')
  const hlsBaseKey = `hls/${videoId}/`

  console.log(`\n[Worker] ═══ Iniciando job ${job.id} para video ${videoId} ═══`)

  // Importar modelo Video (lazy import para evitar problemas de módulos)
  const { default: Video } = await import('../models/Video.js')

  // Variable para los perfiles seleccionados (se define tras ffprobe)
  let selectedProfiles = []

  try {
    // ── Paso 1: Conectar a MongoDB ──────────────────────────────────────────
    await connectMongo()

    // ── Paso 2: Marcar video como "processing" ──────────────────────────────
    await Video.findByIdAndUpdate(videoId, {
      status: 'processing',
      transcodeJobId: job.id,
    })
    await job.updateProgress(5)

    // ── Paso 3: Crear directorio temporal base ──────────────────────────────
    await mkdir(jobDir, { recursive: true })
    await mkdir(outputDir, { recursive: true })

    // ── Paso 4: Descargar MP4 desde B2 ──────────────────────────────────────
    console.log(`[Worker] Descargando MP4: ${rawKey}`)
    await downloadFromB2(rawKey, inputPath)
    await job.updateProgress(15)

    // ── Paso 5: Detectar resolución original con ffprobe ────────────────────
    console.log('[Worker] Detectando resolución del video...')
    const { width: inputWidth, height: inputHeight } = await probeResolution(inputPath)
    console.log(`[Worker] Resolución detectada: ${inputWidth}x${inputHeight}`)

    // ── Paso 6: Filtrar perfiles según resolución ───────────────────────────
    selectedProfiles = getProfilesForInput(inputWidth, inputHeight)
    console.log(`[Worker] Perfiles seleccionados: ${selectedProfiles.map(p => p.name).join(', ')}`)
    await job.updateProgress(20)

    // Crear subdirectorios para cada perfil seleccionado
    for (const profile of selectedProfiles) {
      await mkdir(join(outputDir, profile.name), { recursive: true })
    }

    // ── Paso 7: Transcodificar con FFmpeg ────────────────────────────────────
    console.log('[Worker] Iniciando transcodificación FFmpeg...')
    const duration = await transcodeToHLS(inputPath, outputDir, selectedProfiles, async (percent) => {
      // Mapear progreso FFmpeg (0-95) al rango 20-80 del job total
      const jobProgress = 20 + Math.round(percent * 0.6)
      await job.updateProgress(jobProgress)
    })
    await job.updateProgress(80)

    // ── Paso 8: Subir segmentos HLS a B2 ────────────────────────────────────
    console.log('[Worker] Subiendo segmentos HLS a B2...')
    const filesUploaded = await uploadHLSToB2(outputDir, hlsBaseKey, selectedProfiles)
    await job.updateProgress(90)

    // ── Paso 9: Eliminar MP4 original de B2 ─────────────────────────────────
    console.log(`[Worker] Eliminando MP4 original: ${rawKey}`)
    try {
      await deleteFromB2(rawKey)
    } catch (deleteErr) {
      // No fallar el job si no se puede eliminar el original
      console.warn('[Worker] No se pudo eliminar MP4 original:', deleteErr.message)
    }

    // ── Paso 10: Actualizar MongoDB ──────────────────────────────────────────
    const hlsMasterUrl = `${HLS_BASE_URL}/${hlsBaseKey}master.m3u8`
    const qualities = selectedProfiles.map((p) => p.name)

    await Video.findByIdAndUpdate(videoId, {
      status: 'ready',
      hlsMasterUrl,
      hlsBaseKey,
      qualities,
      duration: Math.round(duration),
      transcodedAt: new Date(),
      transcodeError: null,
      // Limpiar rawKey ya que el archivo fue eliminado
      rawKey: null,
    })

    await job.updateProgress(100)

    console.log(`[Worker] ✅ Video ${videoId} listo: ${hlsMasterUrl}`)
    console.log(`[Worker] Resolución original: ${inputWidth}x${inputHeight}`)
    console.log(`[Worker] Perfiles generados: ${qualities.join(', ')}`)
    console.log(`[Worker] Archivos subidos: ${filesUploaded} | Duración: ${duration}s`)

    return {
      videoId,
      hlsMasterUrl,
      qualities,
      duration: Math.round(duration),
      filesUploaded,
    }

  } catch (error) {
    console.error(`[Worker] ❌ Error procesando job ${job.id}:`, error.message)

    // Marcar video como error en MongoDB
    try {
      await Video.findByIdAndUpdate(videoId, {
        status: 'error',
        transcodeError: error.message,
      })
    } catch (dbErr) {
      console.error('[Worker] No se pudo actualizar estado de error en DB:', dbErr.message)
    }

    // Re-lanzar para que BullMQ maneje los reintentos
    throw error

  } finally {
    // ── Limpieza garantizada de archivos temporales ──────────────────────────
    // Se ejecuta SIEMPRE, incluso si hay error
    try {
      await rm(jobDir, { recursive: true, force: true })
      console.log(`[Worker] Limpieza completada: ${jobDir}`)
    } catch (cleanupErr) {
      console.warn('[Worker] Error en limpieza de temporales:', cleanupErr.message)
    }
  }
}

// ─── Inicialización del Worker ────────────────────────────────────────────────

const startWorker = async () => {
  // Crear directorio temporal base
  await mkdir(TEMP_DIR, { recursive: true })
  console.log(`[Worker] Directorio temporal: ${TEMP_DIR}`)

  const concurrency = parseInt(process.env.WORKER_CONCURRENCY) || 1
  console.log(`[Worker] Concurrencia: ${concurrency}`)

  const worker = new Worker(QUEUE_NAME, processTranscodeJob, {
    connection: createRedisConnection(),
    concurrency,
    // Limitar jobs por minuto para evitar sobrecarga
    limiter: {
      max: parseInt(process.env.WORKER_RATE_LIMIT) || 20,
      duration: 60000,
    },
  })

  // ── Event Listeners ──────────────────────────────────────────────────────
  worker.on('active', (job) => {
    console.log(`[Worker] Job activo: ${job.id} (video: ${job.data.videoId})`)
  })

  worker.on('completed', (job, result) => {
    console.log(`[Worker] Job completado: ${job.id} → ${result?.hlsMasterUrl}`)
  })

  worker.on('failed', (job, err) => {
    console.error(`[Worker] Job fallido: ${job?.id} — ${err.message}`)
    console.error(`[Worker] Intentos realizados: ${job?.attemptsMade}/${job?.opts?.attempts}`)
  })

  worker.on('error', (err) => {
    console.error('[Worker] Error del worker:', err.message)
  })

  worker.on('stalled', (jobId) => {
    console.warn(`[Worker] Job estancado: ${jobId}`)
  })

  // ── Graceful Shutdown ────────────────────────────────────────────────────
  const shutdown = async (signal) => {
    console.log(`\n[Worker] Señal ${signal} recibida. Cerrando gracefully...`)
    await worker.close()
    await mongoose.disconnect()
    console.log('[Worker] Worker cerrado correctamente')
    process.exit(0)
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))

  console.log(`\n[Worker] ✅ Worker iniciado. Escuchando cola "${QUEUE_NAME}"...`)
  console.log('[Worker] Presiona Ctrl+C para detener\n')
}

// Iniciar el worker
startWorker().catch((err) => {
  console.error('[Worker] Error fatal al iniciar:', err)
  process.exit(1)
})
