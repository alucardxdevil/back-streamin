/**
 * Script de Limpieza Automática
 *
 * Elimina archivos temporales huérfanos y archivos raw de B2 que no fueron
 * limpiados correctamente (por ejemplo, si el worker crasheó).
 *
 * Ejecutar manualmente o como cron job:
 *   node server/scripts/cleanup.js
 *
 * Cron recomendado (cada hora):
 *   0 * * * * node /path/to/server/scripts/cleanup.js
 *
 * Qué limpia:
 *  1. Directorios /tmp/transcode/* con más de MAX_AGE_HOURS horas
 *  2. Archivos raw/* en B2 de videos con status 'ready' (MP4 no eliminados)
 *  3. Archivos raw/* en B2 de videos con status 'error' y más de ERROR_RETENTION_DAYS días
 */

import '../config/loadEnv.js'
import { rm, readdir, stat } from 'fs/promises'
import { join } from 'path'
import mongoose from 'mongoose'
import { S3Client, DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3'

// ─── Configuración ────────────────────────────────────────────────────────────
const TEMP_DIR = process.env.TEMP_DIR || '/tmp/transcode'
const MAX_AGE_HOURS = parseInt(process.env.CLEANUP_MAX_AGE_HOURS) || 2
const ERROR_RETENTION_DAYS = parseInt(process.env.CLEANUP_ERROR_RETENTION_DAYS) || 7

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

// ─── Utilidades ───────────────────────────────────────────────────────────────

const formatBytes = (bytes) => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

const hoursSince = (date) => {
  return (Date.now() - new Date(date).getTime()) / (1000 * 60 * 60)
}

const daysSince = (date) => {
  return hoursSince(date) / 24
}

// ─── Limpieza 1: Directorios temporales locales ───────────────────────────────

const cleanLocalTempDirs = async () => {
  console.log('\n[Cleanup] ── Limpiando directorios temporales locales ──')
  console.log(`[Cleanup] Directorio: ${TEMP_DIR}`)
  console.log(`[Cleanup] Eliminando directorios con más de ${MAX_AGE_HOURS} horas`)

  let cleaned = 0
  let errors = 0

  try {
    const entries = await readdir(TEMP_DIR)

    for (const entry of entries) {
      const entryPath = join(TEMP_DIR, entry)

      try {
        const entryStat = await stat(entryPath)
        const ageHours = hoursSince(entryStat.mtime)

        if (ageHours > MAX_AGE_HOURS) {
          await rm(entryPath, { recursive: true, force: true })
          console.log(`[Cleanup] ✅ Eliminado: ${entry} (${ageHours.toFixed(1)}h)`)
          cleaned++
        } else {
          console.log(`[Cleanup] ⏭  Saltando: ${entry} (${ageHours.toFixed(1)}h — muy reciente)`)
        }
      } catch (err) {
        console.error(`[Cleanup] ❌ Error procesando ${entry}:`, err.message)
        errors++
      }
    }
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.log('[Cleanup] Directorio temporal no existe, nada que limpiar')
    } else {
      console.error('[Cleanup] Error leyendo directorio temporal:', err.message)
    }
  }

  console.log(`[Cleanup] Temporales locales: ${cleaned} eliminados, ${errors} errores`)
  return { cleaned, errors }
}

// ─── Limpieza 2: Archivos raw en B2 ──────────────────────────────────────────

const cleanOrphanedRawFiles = async () => {
  console.log('\n[Cleanup] ── Limpiando archivos raw huérfanos en B2 ──')

  // Importar modelo Video
  const { default: Video } = await import('../models/Video.js')

  let cleaned = 0
  let bytesFreed = 0
  let errors = 0

  // Listar todos los archivos raw/ en B2
  let continuationToken = undefined
  const rawFiles = []

  do {
    const listCommand = new ListObjectsV2Command({
      Bucket: B2_BUCKET,
      Prefix: 'raw/',
      ContinuationToken: continuationToken,
    })

    const response = await s3.send(listCommand)

    if (response.Contents) {
      rawFiles.push(...response.Contents)
    }

    continuationToken = response.NextContinuationToken
  } while (continuationToken)

  console.log(`[Cleanup] Archivos raw encontrados en B2: ${rawFiles.length}`)

  for (const file of rawFiles) {
    try {
      // Extraer userId del key: raw/{userId}/{filename}
      const parts = file.Key.split('/')
      if (parts.length < 3) continue

      const userId = parts[1]

      // Buscar video con este rawKey
      const video = await Video.findOne({ rawKey: file.Key })

      if (!video) {
        // Archivo huérfano (no tiene video asociado)
        const ageHours = hoursSince(file.LastModified)
        if (ageHours > MAX_AGE_HOURS) {
          await s3.send(new DeleteObjectCommand({ Bucket: B2_BUCKET, Key: file.Key }))
          console.log(`[Cleanup] ✅ Raw huérfano eliminado: ${file.Key} (${formatBytes(file.Size)})`)
          cleaned++
          bytesFreed += file.Size
        }
        continue
      }

      // Video con status 'ready' pero rawKey no fue limpiado
      if (video.status === 'ready') {
        await s3.send(new DeleteObjectCommand({ Bucket: B2_BUCKET, Key: file.Key }))
        await Video.findByIdAndUpdate(video._id, { rawKey: null })
        console.log(`[Cleanup] ✅ Raw de video listo eliminado: ${file.Key} (${formatBytes(file.Size)})`)
        cleaned++
        bytesFreed += file.Size
        continue
      }

      // Video con status 'error' y más de ERROR_RETENTION_DAYS días
      if (video.status === 'error' && daysSince(video.updatedAt) > ERROR_RETENTION_DAYS) {
        await s3.send(new DeleteObjectCommand({ Bucket: B2_BUCKET, Key: file.Key }))
        await Video.findByIdAndUpdate(video._id, { rawKey: null })
        console.log(`[Cleanup] ✅ Raw de video con error eliminado: ${file.Key} (${formatBytes(file.Size)})`)
        cleaned++
        bytesFreed += file.Size
        continue
      }

    } catch (err) {
      console.error(`[Cleanup] ❌ Error procesando ${file.Key}:`, err.message)
      errors++
    }
  }

  console.log(`[Cleanup] Raw B2: ${cleaned} eliminados (${formatBytes(bytesFreed)} liberados), ${errors} errores`)
  return { cleaned, bytesFreed, errors }
}

// ─── Limpieza 3: Videos pendientes muy antiguos ───────────────────────────────

const cleanStaleVideos = async () => {
  console.log('\n[Cleanup] ── Limpiando videos pendientes/procesando muy antiguos ──')

  const { default: Video } = await import('../models/Video.js')

  // Videos que llevan más de 24h en estado 'pending' o 'processing'
  const staleThreshold = new Date(Date.now() - 24 * 60 * 60 * 1000)

  const staleVideos = await Video.find({
    status: { $in: ['pending', 'processing'] },
    updatedAt: { $lt: staleThreshold },
  })

  console.log(`[Cleanup] Videos estancados encontrados: ${staleVideos.length}`)

  for (const video of staleVideos) {
    await Video.findByIdAndUpdate(video._id, {
      status: 'error',
      transcodeError: 'Timeout: el job no completó en 24 horas',
    })
    console.log(`[Cleanup] ⚠️  Video ${video._id} marcado como error (estancado)`)
  }

  return { updated: staleVideos.length }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const main = async () => {
  console.log('═══════════════════════════════════════════════')
  console.log('  stream-in — Script de Limpieza Automática')
  console.log(`  ${new Date().toISOString()}`)
  console.log('═══════════════════════════════════════════════')

  // Conectar a MongoDB
  await mongoose.connect(process.env.DB_URI)
  console.log('[Cleanup] MongoDB conectado')

  const results = {}

  // Ejecutar limpiezas
  results.localTemp = await cleanLocalTempDirs()
  results.rawFiles = await cleanOrphanedRawFiles()
  results.staleVideos = await cleanStaleVideos()

  // Resumen
  console.log('\n═══════════════════════════════════════════════')
  console.log('  RESUMEN DE LIMPIEZA')
  console.log('═══════════════════════════════════════════════')
  console.log(`  Temporales locales eliminados: ${results.localTemp.cleaned}`)
  console.log(`  Archivos raw B2 eliminados:    ${results.rawFiles.cleaned}`)
  console.log(`  Espacio liberado en B2:        ${formatBytes(results.rawFiles.bytesFreed || 0)}`)
  console.log(`  Videos estancados corregidos:  ${results.staleVideos.updated}`)
  console.log('═══════════════════════════════════════════════\n')

  await mongoose.disconnect()
  process.exit(0)
}

main().catch((err) => {
  console.error('[Cleanup] Error fatal:', err)
  process.exit(1)
})
