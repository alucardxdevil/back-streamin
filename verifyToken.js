import jwt from 'jsonwebtoken'
import { createError } from './err.js'
import User from './models/User.js'
import { extractAccessToken } from './utils/extractAccessToken.js'
import { getJwtSecret } from './utils/secrets.js'

const JWT = getJwtSecret()

export const verifyToken = async (req, res, next) => {
  const token = extractAccessToken(req)
  if (!token) {
    return next(createError(401, 'You are not authenticated!'))
  }

  try {
    const user = jwt.verify(token, JWT, { algorithms: ['HS256'] })

    const userDoc = await User.findById(user.id).select('isDeleted deletedAt tokenVersion').lean()

    if (!userDoc) {
      return next(createError(401, 'You are not authenticated!'))
    }

    if (userDoc.isDeleted) {
      return next(createError(401, 'Account has been deleted'))
    }

    const tokenVersionFromPayload = user.tokenVersion || 1
    if (userDoc.tokenVersion && tokenVersionFromPayload !== userDoc.tokenVersion) {
      return next(createError(401, 'Session expired. Please login again.'))
    }

    req.user = user
    next()
  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return next(createError(403, 'Error authenticated!'))
    }
    next(err)
  }
}
