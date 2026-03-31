/**
 * Utilidad para conversión de imágenes a formato WebP usando sharp.
 *
 * WebP ofrece ~25-35% mejor compresión que JPEG/PNG con calidad visual equivalente.
 * Esto mejora:
 *  - Tiempos de carga (Core Web Vitals: LCP)
 *  - Ancho de banda del CDN
 *  - SEO (Google prioriza sitios rápidos)
 *
 * Formatos soportados como entrada: JPEG, PNG, GIF, BMP, TIFF, SVG, AVIF
 * Formato de salida: WebP
 *
 * Uso:
 *   import { convertToWebP, shouldConvertToWebP } from './utils/convertToWebP.js'
 *
 *   if (shouldConvertToWebP(mimetype)) {
 *     const { buffer, contentType } = await convertToWebP(originalBuffer, { quality: 80 })
 *   }
 */

import sharp from 'sharp'

/**
 * Tipos MIME que se pueden convertir a WebP.
 * SVG se excluye porque es vectorial y no se beneficia de la conversión.
 */
const CONVERTIBLE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/bmp',
  'image/tiff',
  'image/avif',
]

/**
 * Determina si un tipo MIME debe convertirse a WebP.
 * Las imágenes que ya son WebP o SVG no se convierten.
 *
 * @param {string} mimeType — Tipo MIME de la imagen original.
 * @returns {boolean}
 */
export const shouldConvertToWebP = (mimeType) => {
  return CONVERTIBLE_MIME_TYPES.includes(mimeType)
}

/**
 * Convierte un buffer de imagen a formato WebP.
 *
 * @param {Buffer}  inputBuffer — Buffer de la imagen original.
 * @param {Object}  options     — Opciones de conversión.
 * @param {number}  options.quality    — Calidad WebP (1-100). Default: 80.
 * @param {number}  options.maxWidth   — Ancho máximo en px. Default: 1920.
 * @param {number}  options.maxHeight  — Alto máximo en px. Default: 1080.
 * @param {boolean} options.resize     — Si true, redimensiona si excede max. Default: true.
 * @returns {Promise<{ buffer: Buffer, contentType: string, extension: string }>}
 */
export const convertToWebP = async (inputBuffer, options = {}) => {
  const {
    quality = 80,
    maxWidth = 1920,
    maxHeight = 1080,
    resize = true,
  } = options

  let pipeline = sharp(inputBuffer)

  // Redimensionar si excede las dimensiones máximas (sin agrandar)
  if (resize) {
    pipeline = pipeline.resize(maxWidth, maxHeight, {
      fit: 'inside',
      withoutEnlargement: true,
    })
  }

  // Convertir a WebP
  const outputBuffer = await pipeline
    .webp({ quality })
    .toBuffer()

  return {
    buffer: outputBuffer,
    contentType: 'image/webp',
    extension: 'webp',
  }
}

/**
 * Convierte un buffer de imagen a WebP optimizado para thumbnails.
 * Usa dimensiones más pequeñas y calidad ligeramente menor.
 *
 * @param {Buffer} inputBuffer — Buffer de la imagen original.
 * @returns {Promise<{ buffer: Buffer, contentType: string, extension: string }>}
 */
export const convertThumbnailToWebP = async (inputBuffer) => {
  return convertToWebP(inputBuffer, {
    quality: 80,
    maxWidth: 1280,
    maxHeight: 720,
    resize: true,
  })
}

/**
 * Convierte un buffer de imagen a WebP optimizado para avatares.
 * Usa dimensiones cuadradas pequeñas.
 *
 * @param {Buffer} inputBuffer — Buffer de la imagen original.
 * @returns {Promise<{ buffer: Buffer, contentType: string, extension: string }>}
 */
export const convertAvatarToWebP = async (inputBuffer) => {
  return convertToWebP(inputBuffer, {
    quality: 80,
    maxWidth: 400,
    maxHeight: 400,
    resize: true,
  })
}

export default { convertToWebP, convertThumbnailToWebP, convertAvatarToWebP, shouldConvertToWebP }
