/**
 * Middleware de Sanitización de Entrada — stream-in
 * 
 * Capa de protección: SANITIZACIÓN DE INPUT (Capa 7)
 * Amenaza cubierta: XSS (Cross-Site Scripting) - inyección de scripts maliciosos
 * 
 * Este middleware sanitiza todos los inputs del body y query params para prevenir
 * ataques XSS mediante la eliminación de caracteres HTML/JavaScript peligrosos.
 */

import { createRequire } from 'module'

const require = createRequire(import.meta.url)

// Intentar cargar sanitize-html
let sanitizeHtml = null
let validator = null

try {
  sanitizeHtml = require('sanitize-html')
} catch {
  console.warn('[Sanitizer] sanitize-html no disponible. Instalar: npm install sanitize-html')
}

try {
  validator = require('validator')
} catch {
  console.warn('[Sanitizer] validator no disponible. Instalar: npm install validator')
}

/**
 * Configuración de sanitización para diferentes tipos de contenido.
 */
const sanitizeOptions = {
  // Campos de texto simple (nombres, títulos)
  simpleText: {
    allowedTags: [],
    allowedAttributes: {},
    allowedStyles: {},
  },
  
  // Campos que permiten algunos tags seguros (descripciones)
  richText: {
    allowedTags: ['b', 'i', 'em', 'strong', 'a', 'p', 'br', 'ul', 'ol', 'li'],
    allowedAttributes: {
      'a': ['href', 'target', 'rel']
    },
    allowedSchemes: ['http', 'https', 'mailto'],
  },
  
  // Tags de video (separados por comas)
  tags: {
    allowedTags: [],
    allowedAttributes: {},
    transformTagName: (tag) => tag.toLowerCase().trim(),
  }
}

/**
 * Sanitiza un string según el tipo de contenido.
 */
const sanitize = (input, type = 'simpleText') => {
  if (!input || typeof input !== 'string') {
    return input
  }

  // Si sanitize-html no está disponible, usar validator.escape como fallback
  if (!sanitizeHtml) {
    if (validator) {
      return validator.escape(input)
    }
    // Fallback básico: remover tags HTML
    return input.replace(/<[^>]*>/g, '')
  }

  const options = sanitizeOptions[type] || sanitizeOptions.simpleText
  return sanitizeHtml(input, options)
}

/**
 * Sanitiza un array de strings (ej: tags de video).
 */
const sanitizeArray = (arr, type = 'simpleText') => {
  if (!Array.isArray(arr)) {
    return arr
  }
  return arr.map(item => sanitize(item, type))
}

/**
 * Sanitiza un objeto completo (profundo).
 */
const sanitizeObject = (obj, fieldTypes = {}) => {
  if (!obj || typeof obj !== 'object') {
    return obj
  }
  
  const sanitized = {}
  
  for (const [key, value] of Object.entries(obj)) {
    const type = fieldTypes[key] || 'simpleText'
    
    if (value === null || value === undefined) {
      sanitized[key] = value
    } else if (Array.isArray(value)) {
      sanitized[key] = sanitizeArray(value, type)
    } else if (typeof value === 'object') {
      // Recursivo para objetos anidados
      sanitized[key] = sanitizeObject(value, fieldTypes)
    } else if (typeof value === 'string') {
      sanitized[key] = sanitize(value, type)
    } else {
      sanitized[key] = value
    }
  }
  
  return sanitized
}

/**
 * Mapeo de campos a tipos de sanitización para los endpoints comunes.
 */
const fieldTypeMap = {
  // Videos
  video: {
    title: 'simpleText',
    description: 'richText',
    tags: 'tags'
  },
  
  // Usuarios
  user: {
    name: 'simpleText',
    descriptionAccount: 'richText'
  },
  
  // Playlists
  playlist: {
    name: 'simpleText',
    description: 'richText'
  },
  
  // Comentarios
  comment: {
    text: 'richText'
  }
}

/**
 * Middleware principal de sanitización.
 * Aplica sanitización al body y query params.
 */
export const sanitizeInput = (resourceType = 'video') => {
  return (req, res, next) => {
    const types = fieldTypeMap[resourceType] || fieldTypeMap.video
    
    // Sanitizar body
    if (req.body && typeof req.body === 'object') {
      req.body = sanitizeObject(req.body, types)
    }
    
    // Sanitizar query params (solo strings)
    if (req.query && typeof req.query === 'object') {
      for (const [key, value] of Object.entries(req.query)) {
        if (typeof value === 'string') {
          req.query[key] = sanitize(value, 'simpleText')
        }
      }
    }
    
    next()
  }
}

/**
 * Middleware de sanitización específico para rutas de video.
 */
export const sanitizeVideoInput = sanitizeInput('video')

/**
 * Middleware de sanitización específico para rutas de usuario.
 */
export const sanitizeUserInput = sanitizeInput('user')

/**
 * Middleware de sanitización específico para rutas de playlist.
 */
export const sanitizePlaylistInput = sanitizeInput('playlist')

/**
 * Middleware de sanitización específico para rutas de comentarios.
 */
export const sanitizeCommentInput = sanitizeInput('comment')

/**
 * Valida y limpia tags de video (alphanuméricos, guiones, sin scripts).
 */
export const sanitizeVideoTags = (tags) => {
  if (!Array.isArray(tags)) {
    return []
  }
  
  return tags
    .map(tag => {
      if (typeof tag !== 'string') return ''
      // Solo permitir alphanuméricos, espacios, guiones y guiones bajos
      return tag.replace(/[^a-zA-Z0-9\s\-_]/g, '').trim()
    })
    .filter(tag => tag.length > 0 && tag.length <= 50)
    .slice(0, 20) // Máximo 20 tags
}

/**
 * Valida URLs para prevenir SSRF y URLs maliciosas.
 */
export const sanitizeUrl = (url) => {
  if (!url || typeof url !== 'string') {
    return null
  }
  
  try {
    const parsed = new URL(url)
    
    // Solo permitir http y https
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return null
    }
    
    // Bloquear URLs internas/localhost
    const hostname = parsed.hostname.toLowerCase()
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '0.0.0.0' ||
      hostname.startsWith('192.168.') ||
      hostname.startsWith('10.') ||
      hostname.startsWith('172.16.') ||
      hostname.endsWith('.local')
    ) {
      return null
    }
    
    return url
  } catch {
    return null
  }
}

export default {
  sanitizeInput,
  sanitizeVideoInput,
  sanitizeUserInput,
  sanitizePlaylistInput,
  sanitizeCommentInput,
  sanitizeVideoTags,
  sanitizeUrl,
}
