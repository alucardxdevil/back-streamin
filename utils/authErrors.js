/**
 * Maps MongoDB duplicate key errors to user-friendly auth responses.
 */
export function handleMongoDuplicateError(err, res) {
  if (err?.code !== 11000) {
    return false
  }

  const keyPattern = err.keyPattern || {}
  const field = Object.keys(keyPattern)[0] || 'field'

  const messages = {
    name: 'This username is already taken. Please choose another one.',
    email: 'An account with this email already exists. Try signing in instead.',
    slug: 'This username is already taken. Please choose another one.',
    googleId: 'This Google account is already linked to another user.',
  }

  return res.status(409).json({
    success: false,
    message: messages[field] || 'This username or email is already registered.',
    field,
  })
}
