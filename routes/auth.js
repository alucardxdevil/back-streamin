import express from 'express';
import { googleAuth, logoutHandler, signin, signup } from "../controllers/auth.js";

const router = express.Router()

// create a user
router.post('/signup', signup)

// sign in
router.post('/signin', signin)

//google auth
router.post('/google', googleAuth)

// logout
router.post('/logout', logoutHandler)

export default router
