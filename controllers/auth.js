import mongoose from "mongoose"
import User from '../models/User.js'
import bcrypt from 'bcryptjs'
import { createError } from "../err.js"
import jwt from 'jsonwebtoken'
import { verifyToken } from "../verifyToken.js"
import cookieParser from "cookie-parser"

const JWT = process.env.JWT || 'token.01010101'

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
            maxAge: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30
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
                httpOnly: true
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
                maxAge: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30
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