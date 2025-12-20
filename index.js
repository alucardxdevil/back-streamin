import express from 'express'
import mongoose from 'mongoose'
import dotenv from 'dotenv'
import cookieParser from 'cookie-parser'
import userRoute from './routes/users.js'
import videoRoute from './routes/videos.js'
import commentRoute from './routes/comments.js'
import authRoute from './routes/auth.js'
import cors from 'cors'


const app = express()
dotenv.config()

mongoose.set('strictQuery', false)
const connect = () => {
    mongoose.connect(process.env.DB_URI).then(() => {
        console.log('Connect to DB')
    })
    .catch((err) => {
        throw err
    })
}
app.use(cookieParser())
app.use(express.json())
app.use('/api',cors())

app.use('/api/users', userRoute)
app.use('/api/videos', videoRoute)
app.use('/api/comments', commentRoute)
app.use('/api/auth', authRoute)

app.use((err, req, res, next) => {
    const status = err.status || 500
    const message = err.message || 'Error server'
    return res.status(status).json({
        success: false,
        status,
        message
    })
})

const PORT = process.env.PORT || 5000

app.get('/health', (req, res) => {
    res.status(200).json({ status: 'OK' });
});

app.listen(PORT,  () => {
    connect()
    console.log(`Connected on port ${PORT}`)
})