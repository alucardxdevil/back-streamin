import fetch from 'node-fetch'
import logger from '../config/logger.js'

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || ''

/**
 * Verifies a Google ID token via Google's tokeninfo endpoint.
 * Returns normalized profile data or null if verification fails.
 */
export async function verifyGoogleIdToken(idToken) {
  if (!idToken || typeof idToken !== 'string') {
    return null
  }

  try {
    const response = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`
    )

    if (!response.ok) {
      logger.warn('Google idToken verification failed', { status: response.status })
      return null
    }

    const payload = await response.json()

    if (GOOGLE_CLIENT_ID && payload.aud !== GOOGLE_CLIENT_ID) {
      logger.warn('Google idToken audience mismatch', {
        expected: GOOGLE_CLIENT_ID,
        received: payload.aud,
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
