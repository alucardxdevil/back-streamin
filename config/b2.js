/**
 * Configuración de Backblaze B2 como almacenamiento S3-compatible
 */

import { S3Client } from '@aws-sdk/client-s3'
import { v4 as uuidv4 } from 'uuid'
import './loadEnv.js'

// Validar variables de entorno requeridas
const requiredEnvVars = [
  'B2_KEY_ID',
  'B2_APP_KEY',
  'B2_BUCKET_NAME',
  'B2_REGION',
  'B2_ENDPOINT'
]

const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar])

if (missingEnvVars.length > 0) {
  console.error(`⚠️  Variables de entorno faltantes: ${missingEnvVars.join(', ')}`)
}

// Configuración del cliente S3 para Backblaze B2
export const s3Client = new S3Client({
  endpoint: process.env.B2_ENDPOINT || 'https://s3.us-east-005.backblazeb2.com',
  region: process.env.B2_REGION || 'us-east-005',
  credentials: {
    accessKeyId: process.env.B2_KEY_ID,
    secretAccessKey: process.env.B2_APP_KEY,
  },
  forcePathStyle: true,
  requestChecksumCalculation: "WHEN_REQUIRED"
})

// Configuración del bucket
export const B2_CONFIG = {
  bucket: process.env.B2_BUCKET_NAME || 'streamin-videos',
  region: process.env.B2_REGION || 'us-east-005',
  endpoint: process.env.B2_ENDPOINT || 'https://s3.us-east-005.backblazeb2.com',
  publicUrl: process.env.B2_PUBLIC_URL || 'https://f00.backblazeb2.com/file/streamin-videos',
  maxUploadSize: (parseInt(process.env.MAX_UPLOAD_SIZE_MB) || 800) * 1024 * 1024,
  signedUrlExpiration: 3600,
}

console.log('[B2 Config] Bucket:', B2_CONFIG.bucket)
console.log('[B2 Config] Region:', B2_CONFIG.region)
console.log('[B2 Config] Endpoint:', B2_CONFIG.endpoint)
console.log('[B2 Config] Public URL:', B2_CONFIG.publicUrl)

// Tipos MIME permitidos
export const ALLOWED_MIME_TYPES = {
  images: [
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/svg+xml',
    'image/bmp',
    'image/tiff'
  ],
  videos: [
    'video/mp4',
    'video/webm',
    'video/ogg',
    'video/quicktime',
    'video/x-msvideo',
    'video/x-matroska',
    'video/mpeg',
    'video/3gpp',
    'video/3gpp2'
  ]
}

export const getAllowedMimeTypes = () => [
  ...ALLOWED_MIME_TYPES.images,
  ...ALLOWED_MIME_TYPES.videos
]

export const getPublicUrl = (fileKey) => {
  return `${B2_CONFIG.publicUrl}/${fileKey}`
}

export const generateFileKey = (userId, fileName, mimeType) => {
  const timestamp = Date.now()
  const extension = getExtensionFromMimeType(mimeType)
  const sanitizedName = sanitizeFileName(fileName)
  
  return `uploads/${userId}/${timestamp}-${uuidv4()}.${extension}`
}

export const getExtensionFromMimeType = (mimeType) => {
  const mimeToExtension = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
    'image/bmp': 'bmp',
    'image/tiff': 'tiff',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'video/ogg': 'ogv',
    'video/quicktime': 'mov',
    'video/x-msvideo': 'avi',
    'video/x-matroska': 'mkv',
    'video/mpeg': 'mpeg',
    'video/3gpp': '3gp',
    'video/3gpp2': '3g2'
  }
  
  return mimeToExtension[mimeType] || 'bin'
}

export const sanitizeFileName = (fileName) => {
  return fileName
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_{2,}/g, '_')
    .substring(0, 100)
}

export const getFileType = (mimeType) => {
  if (ALLOWED_MIME_TYPES.images.includes(mimeType)) return 'image'
  if (ALLOWED_MIME_TYPES.videos.includes(mimeType)) return 'video'
  return null
}

export default s3Client
