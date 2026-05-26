/**
 * Validación centralizada de secretos criptográficos.
 * En producción, la aplicación debe fallar al arrancar si faltan secretos seguros.
 */

const WEAK_SECRETS = new Set([
  'token.01010101',
  'session-secret-change-in-production',
  'changeme',
  'secret',
  'jwt_secret',
])

function isWeakSecret(value) {
  if (!value || typeof value !== 'string') return true
  const trimmed = value.trim()
  if (trimmed.length < 32) return true
  return WEAK_SECRETS.has(trimmed.toLowerCase())
}

/**
 * Obtiene el secreto JWT. En producción exige JWT (o JWT_SECRET) seguro.
 * @returns {string}
 */
export function getJwtSecret() {
  const secret = process.env.JWT || process.env.JWT_SECRET
  if (process.env.NODE_ENV === 'production') {
    if (isWeakSecret(secret)) {
      throw new Error(
        'JWT (o JWT_SECRET) debe estar definido con al menos 32 caracteres aleatorios en producción'
      )
    }
    return secret.trim()
  }
  return secret?.trim() || 'dev-only-jwt-secret-not-for-production-use'
}

/**
 * Obtiene el secreto de sesión anónima. En producción exige SESSION_SECRET seguro.
 * @returns {string}
 */
export function getSessionSecret() {
  const secret = process.env.SESSION_SECRET || process.env.JWT_SECRET || process.env.JWT
  if (process.env.NODE_ENV === 'production') {
    if (isWeakSecret(secret)) {
      throw new Error(
        'SESSION_SECRET debe estar definido con al menos 32 caracteres aleatorios en producción'
      )
    }
    return secret.trim()
  }
  return secret?.trim() || 'dev-only-session-secret-not-for-production'
}

/**
 * Valida secretos al arrancar el servidor.
 */
export function validateSecretsOnStartup() {
  getJwtSecret()
  getSessionSecret()

  if (
    process.env.NODE_ENV === 'production' &&
    !process.env.GOOGLE_CLIENT_ID &&
    !process.env.FIREBASE_PROJECT_ID
  ) {
    console.warn(
      '[Security] FIREBASE_PROJECT_ID no configurado — login con Google (Firebase Auth) fallará en producción'
    )
  }
}
