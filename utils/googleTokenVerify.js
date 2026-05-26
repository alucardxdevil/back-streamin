import jwt from 'jsonwebtoken'
import jwksClient from 'jwks-rsa'
import fetch from 'node-fetch'
import logger from '../config/logger.js'

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || ''
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || ''

const FIREBASE_JWKS_URI =
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'

let firebaseJwks = null

function getAllowedAudiences() {
  const extra = (process.env.GOOGLE_ALLOWED_AUDIENCES || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  return [...new Set([GOOGLE_CLIENT_ID, FIREBASE_PROJECT_ID, ...extra].filter(Boolean))]
}

function isFirebaseIssuer(issuer) {
  return typeof issuer === 'string' && issuer.startsWith('https://securetoken.google.com/')
}

function getFirebaseJwksClient() {
  if (!firebaseJwks) {
    firebaseJwks = jwksClient({
      jwksUri: FIREBASE_JWKS_URI,
      cache: true,
      cacheMaxAge: 60 * 60 * 1000,
      rateLimit: true,
      jwksRequestsPerMinute: 10,
    })
  }
  return firebaseJwks
}

function getFirebaseSigningKey(kid) {
  return new Promise((resolve, reject) => {
    getFirebaseJwksClient().getSigningKey(kid, (err, key) => {
      if (err) return reject(err)
      resolve(key.getPublicKey())
    })
  })
}

function decodeJwtPart(part) {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'))
}

function normalizeProfile(payload) {
  return {
    googleId: payload.sub,
    email: (payload.email || '').toLowerCase(),
    name: payload.name || payload.given_name || '',
    img: payload.picture || '',
    emailVerified: payload.email_verified === true || payload.email_verified === 'true',
  }
}

async function verifyFirebaseIdToken(idToken) {
  if (!FIREBASE_PROJECT_ID) {
    logger.error('FIREBASE_PROJECT_ID requerido para verificar tokens de Firebase Auth')
    return null
  }

  try {
    const header = decodeJwtPart(idToken.split('.')[0])
    if (!header.kid) {
      logger.warn('Firebase idToken sin kid en header')
      return null
    }

    const publicKey = await getFirebaseSigningKey(header.kid)
    const payload = jwt.verify(idToken, publicKey, {
      algorithms: ['RS256'],
      audience: FIREBASE_PROJECT_ID,
      issuer: `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`,
    })

    return normalizeProfile(payload)
  } catch (error) {
    logger.warn('Firebase idToken JWT verify failed', {
      message: error.message,
      projectId: FIREBASE_PROJECT_ID,
    })
    return null
  }
}

/** Fallback para tokens OAuth de Google (no Firebase) — p.ej. app móvil directa */
async function verifyGoogleOAuthIdToken(idToken) {
  const allowedAudiences = getAllowedAudiences()

  try {
    const response = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`
    )

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      logger.warn('Google OAuth idToken tokeninfo failed', {
        status: response.status,
        body: body.slice(0, 200),
      })
      return null
    }

    const payload = await response.json()

    if (!payload.sub) return null

    if (allowedAudiences.length > 0 && !allowedAudiences.includes(payload.aud)) {
      logger.warn('Google OAuth idToken audience mismatch', {
        allowedAudiences,
        received: payload.aud,
      })
      return null
    }

    return normalizeProfile(payload)
  } catch (error) {
    logger.error('Google OAuth idToken verification error', { message: error.message })
    return null
  }
}

/**
 * Verifica idToken de Firebase Auth (web) u OAuth de Google (fallback).
 * Firebase tokens NO funcionan con oauth2/tokeninfo — usan JWKS de securetoken.
 */
export async function verifyGoogleIdToken(idToken) {
  if (!idToken || typeof idToken !== 'string') {
    return null
  }

  const token = idToken.trim()
  const parts = token.split('.')

  if (parts.length !== 3) {
    logger.warn('idToken no tiene formato JWT', { segments: parts.length, length: token.length })
    return null
  }

  if (process.env.NODE_ENV === 'production' && !FIREBASE_PROJECT_ID && !GOOGLE_CLIENT_ID) {
    logger.error('FIREBASE_PROJECT_ID o GOOGLE_CLIENT_ID requerido en producción')
    return null
  }

  let unsafePayload
  try {
    unsafePayload = decodeJwtPart(parts[1])
  } catch {
    logger.warn('idToken payload ilegible', { length: token.length })
    return null
  }

  if (isFirebaseIssuer(unsafePayload.iss)) {
    return verifyFirebaseIdToken(token)
  }

  return verifyGoogleOAuthIdToken(token)
}
