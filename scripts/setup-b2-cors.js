/**
 * Script para configurar CORS en el bucket de Backblaze B2
 *
 * Capa de protección: CORS EN B2 (Capa 5)
 * Amenaza cubierta: Acceso directo al bucket de B2 desde dominios no autorizados.
 *   Esta es una capa de defensa secundaria que complementa el proxy backend.
 *   Incluso si alguien obtiene una URL de B2, el navegador bloqueará la solicitud
 *   si no proviene del dominio autorizado.
 *
 * IMPORTANTE: Con el proxy backend implementado, el cliente NUNCA accede
 * directamente a B2. Esta configuración CORS es una capa adicional de seguridad
 * para el caso en que el proxy falle o sea bypasseado.
 *
 * Ejecutar UNA VEZ (o cuando cambien los dominios):
 *   node server/scripts/setup-b2-cors.js
 *
 * Para modo restrictivo (solo servidor backend, sin acceso directo del navegador):
 *   node server/scripts/setup-b2-cors.js --mode=proxy-only
 *
 * Para modo con acceso directo (solo para uploads desde el navegador):
 *   node server/scripts/setup-b2-cors.js --mode=upload-only
 *
 * Requiere las variables de entorno B2_KEY_ID, B2_APP_KEY, B2_BUCKET_NAME
 * configuradas en server/.env
 */

import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '../.env') })

const B2_KEY_ID = process.env.B2_KEY_ID
const B2_APP_KEY = process.env.B2_APP_KEY
const B2_BUCKET_NAME = process.env.B2_BUCKET_NAME

if (!B2_KEY_ID || !B2_APP_KEY || !B2_BUCKET_NAME) {
  console.error('❌ Faltan variables de entorno: B2_KEY_ID, B2_APP_KEY, B2_BUCKET_NAME')
  process.exit(1)
}

// Determinar modo de operación
const args = process.argv.slice(2)
const modeArg = args.find(a => a.startsWith('--mode='))
const mode = modeArg ? modeArg.split('=')[1] : 'upload-only'

// Orígenes permitidos — leer desde .env o usar valores por defecto
const rawOrigins = process.env.ALLOWED_ORIGINS || ''
const configuredOrigins = rawOrigins.split(',').map(o => o.trim()).filter(Boolean)

// Orígenes de desarrollo siempre incluidos
const devOrigins = [
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:5000',
]

// Combinar orígenes configurados con los de desarrollo
const ALL_ALLOWED_ORIGINS = [...new Set([...configuredOrigins, ...devOrigins])]

console.log('📋 Modo:', mode)
console.log('🌐 Orígenes permitidos:', ALL_ALLOWED_ORIGINS)

/**
 * Reglas CORS para modo proxy-only:
 *
 * En este modo, el bucket de B2 SOLO permite solicitudes del servidor backend.
 * El navegador del usuario NUNCA accede directamente a B2.
 * Solo se permiten operaciones de escritura (upload) desde el frontend.
 *
 * Usar cuando: El proxy backend está completamente implementado y funcional.
 */
const CORS_RULES_PROXY_ONLY = [
  {
    corsRuleName: 'allowUploadOnly',
    // Solo permitir uploads directos desde el frontend (para subir videos)
    allowedOrigins: ALL_ALLOWED_ORIGINS,
    allowedOperations: [
      's3_put',    // PUT presigned URL para subida de videos
      's3_post',   // POST presigned (createPresignedPost)
      's3_head',   // HEAD para verificar existencia del archivo
    ],
    // NO incluir 's3_get' — las lecturas van por el proxy backend
    allowedHeaders: [
      'content-type',
      'content-length',
      'x-amz-content-sha256',
      'x-amz-date',
      'authorization',
    ],
    exposeHeaders: ['ETag', 'x-amz-request-id'],
    maxAgeSeconds: 3600,
  },
]

/**
 * Reglas CORS para modo upload-only (compatibilidad con flujo actual):
 *
 * Permite tanto uploads como lecturas desde el frontend.
 * Usar durante la transición al proxy backend.
 */
const CORS_RULES_UPLOAD_ONLY = [
  {
    corsRuleName: 'allowUploadAndRead',
    allowedOrigins: ALL_ALLOWED_ORIGINS,
    allowedOperations: [
      's3_put',    // PUT presigned URL para subida de videos
      's3_post',   // POST presigned (createPresignedPost)
      's3_head',   // HEAD para verificar existencia
      's3_get',    // GET para lectura (solo desde orígenes autorizados)
    ],
    allowedHeaders: [
      'content-type',
      'content-length',
      'x-amz-content-sha256',
      'x-amz-date',
      'authorization',
      'range',
    ],
    exposeHeaders: ['ETag', 'x-amz-request-id', 'Content-Range', 'Accept-Ranges'],
    maxAgeSeconds: 3600,
  },
]

// Seleccionar reglas según el modo
const CORS_RULES = mode === 'proxy-only' ? CORS_RULES_PROXY_ONLY : CORS_RULES_UPLOAD_ONLY

async function authorize() {
  const credentials = Buffer.from(`${B2_KEY_ID}:${B2_APP_KEY}`).toString('base64')
  const res = await fetch('https://api.backblazeb2.com/b2api/v3/b2_authorize_account', {
    headers: { Authorization: `Basic ${credentials}` },
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Autorización fallida: ${err}`)
  }
  return res.json()
}

async function getBucketId(apiUrl, authToken, bucketName) {
  const res = await fetch(`${apiUrl}/b2api/v3/b2_list_buckets`, {
    method: 'POST',
    headers: {
      Authorization: authToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ bucketName }),
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Error listando buckets: ${err}`)
  }
  const data = await res.json()
  const bucket = data.buckets?.[0]
  if (!bucket) throw new Error(`Bucket "${bucketName}" no encontrado`)
  return bucket.bucketId
}

async function updateBucketCors(apiUrl, authToken, bucketId, corsRules) {
  const res = await fetch(`${apiUrl}/b2api/v3/b2_update_bucket`, {
    method: 'POST',
    headers: {
      Authorization: authToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ bucketId, corsRules }),
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Error actualizando CORS: ${err}`)
  }
  return res.json()
}

async function main() {
  console.log('🔐 Autorizando con Backblaze B2...')
  const auth = await authorize()
  const { apiInfo, authorizationToken } = auth
  const apiUrl = apiInfo?.storageApi?.apiUrl || auth.apiUrl

  console.log(`✅ Autorizado. API URL: ${apiUrl}`)
  console.log(`🪣 Buscando bucket: ${B2_BUCKET_NAME}`)

  const bucketId = await getBucketId(apiUrl, authorizationToken, B2_BUCKET_NAME)
  console.log(`✅ Bucket encontrado: ${bucketId}`)

  console.log('⚙️  Configurando reglas CORS...')
  console.log('   Modo:', mode)
  console.log('   Orígenes permitidos:', ALL_ALLOWED_ORIGINS)
  console.log('   Operaciones permitidas:', CORS_RULES[0].allowedOperations)

  const result = await updateBucketCors(apiUrl, authorizationToken, bucketId, CORS_RULES)
  console.log('✅ CORS configurado exitosamente')
  console.log('   Reglas aplicadas:', JSON.stringify(result.corsRules, null, 2))

  if (mode === 'proxy-only') {
    console.log('\n⚠️  MODO PROXY-ONLY ACTIVO:')
    console.log('   - El bucket de B2 NO permite lecturas directas desde el navegador')
    console.log('   - Todo el contenido de video debe servirse a través del proxy backend')
    console.log('   - Asegúrate de que /api/stream/* esté funcionando correctamente')
  } else {
    console.log('\n📝 MODO UPLOAD-ONLY ACTIVO:')
    console.log('   - El bucket permite lecturas desde los orígenes autorizados')
    console.log('   - Para máxima seguridad, migrar a modo proxy-only cuando el proxy esté listo')
    console.log('   - Ejecutar: node server/scripts/setup-b2-cors.js --mode=proxy-only')
  }
}

main().catch((err) => {
  console.error('❌ Error:', err.message)
  process.exit(1)
})
