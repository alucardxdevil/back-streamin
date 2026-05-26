/**
 * Campos permitidos en operaciones de video (prevención de mass assignment).
 */

/** Campos que el cliente puede enviar al crear un video */
export const VIDEO_CREATE_FIELDS = new Set([
  'title',
  'description',
  'classification',
  'tags',
  'imgUrl',
  'imgKey',
  'videoUrl',
  'videoKey',
  'fileType',
  'duration',
  'fileSize',
])

/** Campos que el propietario puede actualizar */
export const VIDEO_UPDATE_FIELDS = new Set([
  'title',
  'description',
  'classification',
  'tags',
  'imgUrl',
  'imgKey',
])

/**
 * Extrae solo los campos permitidos de un objeto de request.
 * @param {object} body
 * @param {Set<string>} allowedFields
 * @returns {object}
 */
export function pickAllowedFields(body, allowedFields) {
  if (!body || typeof body !== 'object') return {}
  const result = {}
  for (const key of allowedFields) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      result[key] = body[key]
    }
  }
  return result
}
