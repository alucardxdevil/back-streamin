import express from 'express';
import {
    forgotPassword,
    googleAuth,
    login,
    logoutHandler,
    register,
    resetPasswordWithToken,
    signin,
    signup,
} from "../controllers/auth.js";
import {
    validateGoogleBody,
    validateSigninBody,
    validateSignupBody,
} from "../middleware/validateAuth.js";
import { authRateLimiter } from "../middleware/rateLimiter.js";

const router = express.Router()

// Email/password registration
router.post('/signup', authRateLimiter, validateSignupBody, signup)
router.post('/register', authRateLimiter, validateSignupBody, register)

// Email/password login
router.post('/signin', authRateLimiter, validateSigninBody, signin)
router.post('/login', authRateLimiter, validateSigninBody, login)

// Google OAuth (client obtains token; server verifies idToken when provided)
router.post('/google', authRateLimiter, validateGoogleBody, googleAuth)

router.post('/logout', logoutHandler)
router.post('/forgot-password', authRateLimiter, forgotPassword)
router.post('/reset-password', authRateLimiter, resetPasswordWithToken)

export default router
