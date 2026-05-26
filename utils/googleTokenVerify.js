import fetch from 'node-fetch'
import logger from '../config/logger.js'

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || ''
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || ''

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

function issuerMatchesProject(issuer) {
  if (!isFirebaseIssuer(issuer)) return true
  if (!FIREBASE_PROJECT_ID) return true
  const projectFromIss = issuer.replace('https://securetoken.google.com/', '')
  return projectFromIss === FIREBASE_PROJECT_ID
}

/**
 * Verifies a Firebase / Google ID token.
 * Frontend uses Firebase Auth → aud is typically FIREBASE_PROJECT_ID, not GOOGLE_CLIENT_ID.
 */
export async function verifyGoogleIdToken(idToken) {
  if (!idToken || typeof idToken !== 'string') {
    return null
  }

  const allowedAudiences = getAllowedAudiences()

  if (process.env.NODE_ENV === 'production' && allowedAudiences.length === 0) {
    logger.error(
      'FIREBASE_PROJECT_ID o GOOGLE_CLIENT_ID requerido en producción para verificar login con Google'
    )
    return null
  }

  try {
    const response = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`
    )

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      logger.warn('Google idToken verification failed', {
        status: response.status,
        body: body.slice(0, 200),
      })
      return null
    }

    const payload = await response.json()

    if (!payload.sub) {
      logger.warn('Google idToken missing sub claim')
      return null
    }

    if (allowedAudiences.length > 0 && !allowedAudiences.includes(payload.aud)) {
      logger.warn('Google idToken audience mismatch', {
        allowedAudiences,
        received: payload.aud,
        hint: 'Con Firebase Auth, aud suele ser FIREBASE_PROJECT_ID (no el OAuth client ID)',
      })
      return null
    }

    if (!issuerMatchesProject(payload.iss)) {
      logger.warn('Firebase issuer mismatch', {
        expectedProject: FIREBASE_PROJECT_ID,
        receivedIssuer: payload.iss,
      })
      return null
    }

    return {
      googleId: payload.sub,
      email: (payload.email || '').toLowerCase(),
      name: payload.name || payload.given_name || '',
      img: payload.picture || '',
      emailVerified: payload.email_verified === 'true' || payload.email_verified === true,
    }
  } catch (error) {
    logger.error('Google idToken verification error', { message: error.message })
    return null
  }
}
