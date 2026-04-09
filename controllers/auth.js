import mongoose from "mongoose"
import User from '../models/User.js'
import bcrypt from 'bcryptjs'
import { createError } from "../err.js"
import jwt from 'jsonwebtoken'
import { verifyToken } from "../verifyToken.js"
import cookieParser from "cookie-parser"
import fetch from "node-fetch"
import crypto from "crypto"

const JWT = process.env.JWT || 'token.01010101'
const RESEND_API_KEY = process.env.RESEND_API_KEY || ''
const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev'
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000'
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000 // 1 hora

function hashPasswordResetToken(rawToken) {
    return crypto.createHash('sha256').update(rawToken, 'utf8').digest('hex')
}

export const signup = async (req, res, next) => {

    const {password, ...rest} = req.body

    if (!password) {
        return res.status(400).send('Password is required')
    }

    try {
        const salt = bcrypt.genSaltSync(10)
        const hash = bcrypt.hashSync(password, salt)
        const newUser = new User({...rest, password: hash})

        await newUser.save()
        res.status(200).send('User register complete')
    } catch (err) {
        next(err)
    }
}

export const signin = async (req, res, next) => {
    try {
        const user = await User.findOne({email: req.body.email})
        if(!user) return next(createError(404, 'User or password incorrect!'))

        const isCorrect = await bcrypt.compare(req.body.password, user.password)
        if(!isCorrect) return next(createError(404, 'User or password incorrect!'))

        const token = jwt.sign({
            id: user._id
        }, JWT)

        const {password, ...others} = user._doc

        res.cookie('access_token', token, {
            httpOnly: true,
            secure: true,
            sameSite: 'none',
            domain: '.stream-in.com',
            maxAge: 30 * 24 * 60 * 60 * 1000 // 30 días
        }).status(200).json(others)

    } catch (err) {
        next(err)
    }
}

export const googleAuth = async (req, res, next) => {
    try {
        const user = await User.findOne({email: req.body.email})
        if(user) {
            const token = jwt.sign({id: user._id}, JWT)

            res.cookie('access_token', token, {
                httpOnly: true,
                secure: true,
                sameSite: 'none',
                domain: '.stream-in.com',
                maxAge: 30 * 24 * 60 * 60 * 1000 // 30 días
            }).status(200).json(user._doc)
        } else {
            const newUser = new User({
                ...req.body,
                fromGoogle: true
            })
            const savedUser = await newUser.save()
            const token = jwt.sign({id: savedUser._id}, JWT)

            res.cookie('access_token', token, {
                httpOnly: true,
                secure: true,
                sameSite: 'none',
                domain: '.stream-in.com',
                maxAge: 30 * 24 * 60 * 60 * 1000 // 30 días
            }).status(200).json(savedUser._doc)
        }
    } catch (err) {
        next(err)
    }
}


// Verificar validacion del usuario  ---pending---
export const verifyUser = async (req, res, next) => {
    const token = req.cookies.access_token
    if(!token) return next(createError(401, 'Not Authenticated'))
    jwt.verify(token, JWT, async (err, user) => {
        if(err) return next(createError(403, 'Token is not valid'))
        req.user = user 
        const foundUser = await User.findById(req.user.id)
        if(!foundUser) return next(createError(404, 'User not found'))
        const {password, ...others} = foundUser._doc
        res.status(200).json(others)
    })
}   

export const logoutHandler = async (req, res) => {
    try {
        res.cookie('access_token', '', {
            httpOnly: true,
            maxAge: 0,
            path: '/'
        }).status(200).send('Logout successful');
    } catch (error) {
        console.error("Error during logout:", error);
        res.status(500).send('Internal Server Error');
    }    
}

export const forgotPassword = async (req, res, next) => {
    const email = (req.body?.email || '').trim().toLowerCase()

    if (!email) {
        return res.status(400).json({ message: 'Email is required.' })
    }

    try {
        const user = await User.findOne({ email })

        // Always return success if the user does not exist or is a Google-only account
        // to avoid user enumeration and to prevent sending reset links for Google users.
        if (!user || user.fromGoogle) {
            return res.status(200).json({
                message: 'If the account exists, a password recovery email has been sent.'
            })
        }

        if (!RESEND_API_KEY) {
            return res.status(500).json({
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
        const subject = 'Recupera tu contrasena - Stream In'
        const html = `
          <div style="font-family: Arial, sans-serif; color: #111;">
            <h2 style="margin-bottom: 8px;">Recuperacion de contrasena</h2>
            <p>Hola ${user.name || ''},</p>
            <p>Recibimos una solicitud para recuperar tu contrasena en Stream In.</p>
            <p>
              Haz clic en el siguiente enlace para continuar:
              <br />
              <a href="${resetUrl}" target="_blank" rel="noopener noreferrer">${resetUrl}</a>
            </p>
            <p>Si no solicitaste este cambio, puedes ignorar este correo.</p>
          </div>
        `

        const resendResponse = await fetch('https://api.resend.com/emails', {
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

        if (!resendResponse.ok) {
            const resendError = await resendResponse.text()
            return res.status(502).json({
                message: 'Could not send password recovery email.',
                details: resendError
            })
        }

        return res.status(200).json({
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
        return res.status(400).json({ message: 'Reset token is required.' })
    }
    if (!password || typeof password !== 'string') {
        return res.status(400).json({ message: 'Password is required.' })
    }
    if (password.length < 6) {
        return res.status(400).json({ message: 'Password must be at least 6 characters.' })
    }

    try {
        const tokenHash = hashPasswordResetToken(rawToken)
        const user = await User.findOne({
            passwordResetTokenHash: tokenHash,
            passwordResetExpires: { $gt: new Date() },
        })

        if (!user) {
            return res.status(400).json({
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
            message: 'Your password has been updated. You can sign in with your new password.',
        })
    } catch (err) {
        next(err)
    }
}
