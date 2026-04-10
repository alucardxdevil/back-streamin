/**
 * Middleware de Validación de Archivos — stream-in
 * 
 * Capa de protección: VALIDACIÓN DE ARCHIVOS (Capa 7)
 * Amenaza cubierta: Upload de archivos maliciosos, MIME spoofing, extensión fake
 * 
 * Proporciona validación robusta de:
 * - Tipo MIME real (usando file-type library)
 * - Extensión de archivo
 * - Magic numbers (magic bytes)
 */

import { createRequire } from 'module'

const require = createRequire(import.meta.url)

// Intentar cargar file-type
let FileType = null
try {
  FileType = require('file-type')
} catch {
  console.warn('[FileValidator] file-type no disponible. Instalar: npm install file-type')
}

// Tipos MIME permitidos
const ALLOWED_MIME_TYPES = {
  image: [
    'image/jpeg',
    'image/png', 
    'image/gif',
    'image/webp',
    'image/svg+xml',
    'image/bmp',
    'image/tiff',
  ],
  video: [
    'video/mp4',
    'video/webm',
    'video/ogg',
    'video/quicktime',
    'video/x-msvideo',
    'video/x-ms-wmv',
  ],
  audio: [
    'audio/mpeg',
    'audio/wav',
    'audio/ogg',
    'audio/webm',
    'audio/aac',
  ],
}

// Extensiones permitidas por tipo
const ALLOWED_EXTENSIONS = {
  image: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.tiff', '.tif'],
  video: ['.mp4', '.webm', '.ogg', '.mov', '.avi', '.wmv', '.mkv'],
  audio: ['.mp3', '.wav', '.ogg', '.aac', '.m4a'],
}

// Extensiones que son malware conocido
const DANGEROUS_EXTENSIONS = [
  '.exe', '.bat', '.cmd', '.com', '.pif', '.msi', '.dll', '.jar',
  '.sh', '.bash', '.zsh', '.ps1', '.scr', '.vbs', '.js', '.jse',
  '.html', '.htm', '.php', '.phtml', '.asp', '.aspx', '.cgi',
  '.sql', '.xml', '.xsl', '.xht', '.xhtml',
]

// Magic numbers para tipos comunes (primeros bytes)
const MAGIC_NUMBERS = {
  'image/jpeg': [0xFF, 0xD8, 0xFF],
  'image/png': [0x89, 0x50, 0x4E, 0x47],
  'image/gif': [0x47, 0x49, 0x46, 0x38],
  'image/webp': [0x52, 0x49, 0x46, 0x46], // RIFF....WEBP
  'image/bmp': [0x42, 0x4D],
  'image/tiff': [0x49, 0x49, 0x2A, 0x00], // Little endian
  'video/mp4': [0x00, 0x00, 0x00], // Usually ftyp after
  'video/webm': [0x1A, 0x45, 0xDF, 0xA3], // EBML
  'audio/wav': [0x52, 0x49, 0x46, 0x46], // RIFF
}

/**
 * Verifica magic numbers contra el tipo MIME declarado
 */
const verifyMagicNumber = (buffer, declaredMimeType) => {
  if (!buffer || buffer.length < 4) return false
  
  const magic = MAGIC_NUMBERS[declaredMimeType]
  if (!magic) return true // Si no hay magic number definido, aceptar
  
  const header = Array.from(buffer.slice(0, 12))
  
  // Verificar los primeros bytes
  for (let i = 0; i < magic.length; i++) {
    if (header[i] !== magic[i]) {
      // Para MP4, verificar después del header RIFF
      if (declaredMimeType === 'video/mp4') {
        return header[4] === 0x66 && header[5] === 0x74 && header[6] === 0x79 && header[7] === 0x70 // 'ftyp'
      }
      return false
    }
  }
  return true
}

/**
 * Obtiene el tipo real del archivo basándose en su contenido
 */
const detectRealFileType = async (buffer) => {
  if (!FileType) {
    console.warn('[FileValidator] file-type no disponible, usando fallback')
    return null
  }
  
  try {
    const result = await FileType.fromBuffer(buffer)
    return result ? result.mime : null
  } catch {
    return null
  }
}

/**
 * Valida un archivo subiduado
 */
export const validateFile = (type = 'image') => {
  return async (req, res, next) => {
    if (!req.file) {
      return next()
    }
    
    const { originalname, mimetype, size, buffer } = req.file
    const allowedMimes = ALLOWED_MIME_TYPES[type] || []
    const allowedExts = ALLOWED_EXTENSIONS[type] || []
    
    // 1. Verificar extensión
    const ext = originalname.toLowerCase().substring(originalname.lastIndexOf('.'))
    if (DANGEROUS_EXTENSIONS.includes(ext)) {
      return next(createError(400, 'Tipo de archivo no permitido'))
    }
    if (!allowedExts.includes(ext)) {
      return next(createError(400, `Extensión ${ext} no permitida para ${type}`))
    }
    
    // 2. Verificar tamaño
    const maxSizes = {
      image: 10 * 1024 * 1024,  // 10 MB
      video: 800 * 1024 * 1024, // 800 MB
      audio: 50 * 1024 * 1024,  // 50 MB
    }
    const maxSize = maxSizes[type] || maxSizes.image
    if (size > maxSize) {
      return next(createError(400, `Archivo muy grande (máx ${maxSize / (1024 * 1024)} MB)`))
    }
    
    // 3. Verificar MIME type declarado vs real
    const realMimeType = await detectRealFileType(buffer)
    
    if (realMimeType && realMimeType !== mimetype) {
      console.warn(`[FileValidator] MIME spoofing detectado: declarado=${mimetype}, real=${realMimeType}`)
      return next(createError(400, 'El tipo de archivo no coincide con su contenido'))
    }
    
    // 4. Verificar magic numbers
    if (!verifyMagicNumber(buffer, mimetype)) {
      return next(createError(400, 'Contenido de archivo inválido'))
    }
    
    // 5. Verificar que el MIME type declarado está en la lista blanca
    if (!allowedMimes.includes(mimetype)) {
      return next(createError(400, `Tipo MIME ${mimetype} no permitido`))
    }
    
    next()
  }
}

/**
 * Middleware específico para validación de imágenes
 */
export const validateImage = validateFile('image')

/**
 * Middleware específico para validación de videos
 */
export const validateVideo = validateFile('video')

/**
 * Middleware específico para validación de audio
 */
export const validateAudio = validateFile('audio')

/**
 * Middleware para validar el body de presigned POST
 */
export const validatePresignedBody = (req, res, next) => {
  const { fileName, contentType, fileSize } = req.body
  
  if (!fileName || !contentType) {
    return next(createError(400, 'fileName y contentType son requeridos'))
  }
  
  // Validar extensión
  const ext = fileName.toLowerCase().substring(fileName.lastIndexOf('.'))
  if (DANGEROUS_EXTENSIONS.includes(ext)) {
    return next(createError(400, 'Tipo de archivo no permitido'))
  }
  
  // Validar que el contentType esté permitido
  const allAllowedMimes = [...ALLOWED_MIME_TYPES.image, ...ALLOWED_MIME_TYPES.video]
  if (!allAllowedMimes.includes(contentType)) {
    return next(createError(400, `Tipo de contenido no permitido: ${contentType}`))
  }
  
  next()
}

import { createError } from "../err.js"

export default {
  validateFile,
  validateImage,
  validateVideo,
  validateAudio,
  validatePresignedBody,
}
