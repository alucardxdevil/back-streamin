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

const router = express.Router()

// Email/password registration
router.post('/signup', validateSignupBody, signup)
router.post('/register', validateSignupBody, register)

// Email/password login
router.post('/signin', validateSigninBody, signin)
router.post('/login', validateSigninBody, login)

// Google OAuth (client obtains token; server verifies idToken when provided)
router.post('/google', validateGoogleBody, googleAuth)

router.post('/logout', logoutHandler)
router.post('/forgot-password', forgotPassword)
router.post('/reset-password', resetPasswordWithToken)

export default router
