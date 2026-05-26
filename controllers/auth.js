import User from '../models/User.js'
import bcrypt from 'bcryptjs'
import { createError } from "../err.js"
import jwt from 'jsonwebtoken'
import { getAccessTokenCookieOptions } from "../utils/cookieOptions.js"
import { userPayloadWithAccessToken } from "../utils/authResponse.js"
import { setCsrfToken, clearCsrfToken } from "../middleware/csrfProtection.js"
import { validatePassword } from "../middleware/validateAuth.js"
import { verifyGoogleIdToken } from "../utils/googleTokenVerify.js"
import { handleMongoDuplicateError } from "../utils/authErrors.js"
import fetch from "node-fetch"
import crypto from "crypto"
import logger from "../config/logger.js"
import { getJwtSecret } from "../utils/secrets.js"

const JWT = getJwtSecret()
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '30d'
const RESEND_API_KEY = process.env.RESEND_API_KEY || ''
const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev'
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000'
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000 // 1 hora

function hashPasswordResetToken(rawToken) {
    return crypto.createHash('sha256').update(rawToken, 'utf8').digest('hex')
}

function issueAuthResponse(res, userDoc, token) {
    const cookieOpts = getAccessTokenCookieOptions()
    const csrfToken = setCsrfToken(res)
    return res
        .cookie('access_token', token, cookieOpts)
        .status(200)
        .json({ ...userPayloadWithAccessToken(userDoc, token), csrfToken })
}

function escapeHtml(str) {
    if (!str || typeof str !== 'string') return ''
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
}

function createAccessToken(userDoc) {
    return jwt.sign({
        id: userDoc._id,
        tokenVersion: userDoc.tokenVersion || 1
    }, JWT, {
        expiresIn: JWT_EXPIRES_IN,
        algorithm: 'HS256',
    })
}

async function assertUserCanLogin(user) {
    if (user.isDeleted) {
        throw createError(403, 'This account has been deleted')
    }
    if (user.isBanned) {
        throw createError(403, 'This account has been banned')
    }
    const now = new Date()
    if (user.bannedUntil && user.bannedUntil > now) {
        throw createError(403, 'This account is temporarily banned')
    }
}

export const signup = async (req, res, next) => {
    const { password, ...rest } = req.body

    try {
        const salt = bcrypt.genSaltSync(10)
        const hash = bcrypt.hashSync(password, salt)
        const newUser = new User({ ...rest, password: hash })

        await newUser.save()
        return res.status(201).json({
            success: true,
            message: 'User registered successfully',
        })
    } catch (err) {
        if (handleMongoDuplicateError(err, res)) return
        next(err)
    }
}

/** Alias for signup — same handler */
export const register = signup

export const signin = async (req, res, next) => {
    try {
        const user = await User.findOne({ email: req.body.email })
        if (!user) return next(createError(404, 'User or password incorrect!'))

        await assertUserCanLogin(user)

        if (user.fromGoogle && !user.password) {
            return next(createError(400, 'This account uses Google Sign-In. Please sign in with Google.'))
        }

        const isCorrect = await bcrypt.compare(req.body.password, user.password)
        if (!isCorrect) return next(createError(404, 'User or password incorrect!'))

        const token = createAccessToken(user)
        return issueAuthResponse(res, user, token)
    } catch (err) {
        next(err)
    }
}

/** Alias for signin — same handler */
export const login = signin

export const googleAuth = async (req, res, next) => {
    try {
        if (!req.body.idToken) {
            return next(createError(401, 'Google idToken is required'))
        }

        const verified = await verifyGoogleIdToken(req.body.idToken)
        if (!verified) {
            return next(createError(401, 'Invalid Google token. Please try again.'))
        }

        if (!verified.emailVerified) {
            return next(createError(401, 'Google email must be verified'))
        }

        const profile = {
            email: verified.email,
            name: verified.name,
            img: verified.img,
            googleId: verified.googleId,
        }

        if (!profile.email) {
            return next(createError(400, 'Google email is required'))
        }

        let user = await User.findOne({
            $or: [
                { email: profile.email },
                ...(profile.googleId ? [{ googleId: profile.googleId }] : []),
            ],
        })

        if (user) {
            await assertUserCanLogin(user)

            const updates = {}
            if (profile.googleId && !user.googleId) updates.googleId = profile.googleId
            if (!user.fromGoogle) updates.fromGoogle = true
            if (profile.img && !user.img) updates.img = profile.img
            if (Object.keys(updates).length > 0) {
                await User.updateOne({ _id: user._id }, { $set: updates })
                user = await User.findById(user._id)
            }

            const token = createAccessToken(user)
            return issueAuthResponse(res, user, token)
        }

        const newUser = new User({
            name: profile.name || profile.email.split('@')[0],
            email: profile.email,
            img: profile.img,
            googleId: profile.googleId || undefined,
            fromGoogle: true,
        })

        try {
            await newUser.save()
        } catch (err) {
            if (handleMongoDuplicateError(err, res)) return
            throw err
        }

        const token = createAccessToken(newUser)
        return issueAuthResponse(res, newUser, token)
    } catch (err) {
        next(err)
    }
}

export const logoutHandler = async (req, res) => {
    try {
        res.cookie('access_token', '', {
            ...getAccessTokenCookieOptions(),
            maxAge: 0,
        })
        clearCsrfToken(res)
        res.status(200).json({ success: true, message: 'Logout successful' })
    } catch (error) {
        console.error("Error during logout:", error)
        res.status(500).json({ success: false, message: 'Internal Server Error' })
    }
}

export const forgotPassword = async (req, res, next) => {
    const email = (req.body?.email || '').trim().toLowerCase()

    if (!email) {
        return res.status(400).json({ success: false, message: 'Email is required.' })
    }

    try {
        const user = await User.findOne({ email })

        if (!user || user.fromGoogle) {
            return res.status(200).json({
                success: true,
                message: 'If the account exists, a password recovery email has been sent.'
            })
        }

        if (!RESEND_API_KEY) {
            return res.status(500).json({
                success: false,
                message: 'Password recovery service is not configured yet.'
            })
        }

        const rawToken = crypto.randomBytes(32).toString('hex')
        const tokenHash = hashPasswordResetToken(rawToken)
        const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS)

        await User.updateOne(
            { email },
            {
                $set: {
                    passwordResetTokenHash: tokenHash,
                    passwordResetExpires: expiresAt,
                },
            }
        )

        const resetUrl = `${FRONTEND_URL}/reset-password?token=${encodeURIComponent(rawToken)}`
        const subject = 'Password Recovery - stream-in'
        const html = `
          <div style="font-family: Arial, sans-serif; color: #111;">
            <h2 style="margin-bottom: 8px;">Password Recovery</h2>
            <p>Hello ${escapeHtml(user.name || '')},</p>
            <p>We received a request to recover your password at stream-in.</p>
            <p>
              Click on the following link to continue:
              <br />
              <a href="${resetUrl}" target="_blank" rel="noopener noreferrer">${resetUrl}</a>
            </p>
            <p>If you did not request this change, you can ignore this email.</p>
          </div>
        `

        let resendResponse
        try {
            resendResponse = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${RESEND_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                from: RESEND_FROM_EMAIL,
                to: [email],
                subject,
                html
            })
            })
        } catch (fetchErr) {
            logger.error('Resend fetch failed', {
                email,
                message: fetchErr?.message,
            })
            return res.status(502).json({
                success: false,
                message: 'Could not send password recovery email.',
            })
        }

        if (!resendResponse.ok) {
            const contentType = resendResponse.headers.get('content-type') || ''
            const resendError = contentType.includes('application/json')
                ? await resendResponse.json().catch(() => null)
                : await resendResponse.text().catch(() => '')

            logger.error('Resend email send failed', {
                email,
                status: resendResponse.status,
                error: resendError,
            })
            return res.status(502).json({
                success: false,
                message: 'Could not send password recovery email.',
            })
        }

        return res.status(200).json({
            success: true,
            message: 'If the account exists, a password recovery email has been sent.'
        })
    } catch (err) {
        next(err)
    }
}

export const resetPasswordWithToken = async (req, res, next) => {
    const rawToken = (req.body?.token || '').trim()
    const password = req.body?.password

    if (!rawToken) {
        return res.status(400).json({ success: false, message: 'Reset token is required.' })
    }
    if (!password || typeof password !== 'string') {
        return res.status(400).json({ success: false, message: 'Password is required.' })
    }

    const passwordValidation = validatePassword(password)
    if (!passwordValidation.valid) {
        return res.status(400).json({ success: false, message: passwordValidation.message })
    }

    try {
        const tokenHash = hashPasswordResetToken(rawToken)
        const user = await User.findOne({
            passwordResetTokenHash: tokenHash,
            passwordResetExpires: { $gt: new Date() },
        })

        if (!user) {
            return res.status(400).json({
                success: false,
                message: 'This reset link is invalid or has expired. Please request a new one.',
            })
        }

        const salt = bcrypt.genSaltSync(10)
        const newHash = bcrypt.hashSync(password, salt)

        await User.updateOne(
            { _id: user._id },
            {
                $set: { password: newHash },
                $unset: { passwordResetTokenHash: '', passwordResetExpires: '' },
            }
        )

        return res.status(200).json({
            success: true,
            message: 'Your password has been updated. You can sign in with your new password.',
        })
    } catch (err) {
        next(err)
    }
}
