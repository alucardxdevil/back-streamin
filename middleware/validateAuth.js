import validator from 'validator'

const PASSWORD_RULES = [
  { test: (p) => p.length >= 8, message: 'Password must be at least 8 characters' },
  { test: (p) => /[A-Z]/.test(p), message: 'Password must include an uppercase letter' },
  { test: (p) => /[a-z]/.test(p), message: 'Password must include a lowercase letter' },
  { test: (p) => /[0-9]/.test(p), message: 'Password must include a number' },
]

export function validatePassword(password) {
  if (!password || typeof password !== 'string') {
    return { valid: false, message: 'Password is required' }
  }
  for (const rule of PASSWORD_RULES) {
    if (!rule.test(password)) {
      return { valid: false, message: rule.message }
    }
  }
  return { valid: true }
}

function validationError(res, message, field = null) {
  return res.status(400).json({
    success: false,
    message,
    ...(field ? { field } : {}),
  })
}

export function validateSignupBody(req, res, next) {
  const name = (req.body?.name || '').trim()
  const email = (req.body?.email || '').trim().toLowerCase()
  const password = req.body?.password

  if (!name || name.length < 3) {
    return validationError(res, 'Username must be at least 3 characters', 'name')
  }
  if (name.length > 50) {
    return validationError(res, 'Username cannot exceed 50 characters', 'name')
  }
  if (!email || !validator.isEmail(email)) {
    return validationError(res, 'A valid email address is required', 'email')
  }
  const passwordCheck = validatePassword(password)
  if (!passwordCheck.valid) {
    return validationError(res, passwordCheck.message, 'password')
  }

  req.body.name = name
  req.body.email = email
  next()
}

export function validateSigninBody(req, res, next) {
  const email = (req.body?.email || '').trim().toLowerCase()
  const password = req.body?.password

  if (!email || !validator.isEmail(email)) {
    return validationError(res, 'A valid email address is required', 'email')
  }
  if (!password || typeof password !== 'string') {
    return validationError(res, 'Password is required', 'password')
  }

  req.body.email = email
  next()
}

export function validateGoogleBody(req, res, next) {
  const email = (req.body?.email || '').trim().toLowerCase()
  const name = (req.body?.name || '').trim()
  const img = (req.body?.img || req.body?.photoUrl || '').trim()
  const googleId = (req.body?.googleId || req.body?.sub || '').trim()
  const idToken = (req.body?.idToken || '').trim()

  if (!email && !idToken) {
    return validationError(res, 'Google email or idToken is required')
  }

  req.body.email = email
  req.body.name = name
  req.body.img = img
  req.body.googleId = googleId
  req.body.idToken = idToken
  next()
}
