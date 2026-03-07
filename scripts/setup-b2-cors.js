/**
 * Script para configurar CORS en el bucket de Backblaze B2
 *
 * Ejecutar UNA VEZ para habilitar subidas directas desde el navegador:
 *   node server/scripts/setup-b2-cors.js
 *
 * Requiere las variables de entorno B2_KEY_ID, B2_APP_KEY, B2_BUCKET_NAME
 * configuradas en server/.env
 *
 * B2 usa su propia API (no S3) para configurar CORS.
 * Documentación: https://www.backblaze.com/apidocs/b2-update-bucket
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

// Orígenes permitidos — agregar todos los dominios de producción
const ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:5173',
  'https://streamin.app',       // ← cambiar por tu dominio real
  'https://www.streamin.app',   // ← cambiar por tu dominio real
]

const CORS_RULES = [
  {
    corsRuleName: 'allowDirectUpload',
    allowedOrigins: ALLOWED_ORIGINS,
    allowedOperations: [
      's3_put',    // PUT presigned URL
      's3_post',   // POST presigned (createPresignedPost)
      's3_head',   // HEAD para verificar existencia
      's3_get',    // GET para descargar/reproducir
    ],
    allowedHeaders: ['*'],
    exposeHeaders: ['ETag', 'x-amz-request-id'],
    maxAgeSeconds: 3600,
  },
]

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
  console.log('   Orígenes permitidos:', ALLOWED_ORIGINS)

  const result = await updateBucketCors(apiUrl, authorizationToken, bucketId, CORS_RULES)
  console.log('✅ CORS configurado exitosamente')
  console.log('   Reglas aplicadas:', JSON.stringify(result.corsRules, null, 2))
}

main().catch((err) => {
  console.error('❌ Error:', err.message)
  process.exit(1)
})
