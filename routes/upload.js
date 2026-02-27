import express from 'express'
import { PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import s3, { B2_BUCKET_NAME } from '../config/s3.js'
import { verifyToken } from '../verifyToken.js'
import crypto from 'crypto'

const router = express.Router()

// Generar URL firmada para subir un archivo (PUT)
router.post('/presign/upload', verifyToken, async (req, res, next) => {
  try {
    const { fileName, contentType, folder } = req.body

    if (!fileName || !contentType) {
      return res.status(400).json({ message: 'fileName y contentType son requeridos' })
    }

    const uniqueName = `${folder ? folder + '/' : ''}${crypto.randomUUID()}-${fileName}`

    const command = new PutObjectCommand({
      Bucket: B2_BUCKET_NAME,
      Key: uniqueName,
      ContentType: contentType,
    })

    const signedUrl = await getSignedUrl(s3, command, { expiresIn: 3600 })

    res.status(200).json({
      uploadUrl: signedUrl,
      key: uniqueName,
    })
  } catch (err) {
    next(err)
  }
})

// Generar URL firmada para leer/descargar un archivo (GET)
router.post('/presign/download', verifyToken, async (req, res, next) => {
  try {
    const { key } = req.body

    if (!key) {
      return res.status(400).json({ message: 'key es requerido' })
    }

    const command = new GetObjectCommand({
      Bucket: B2_BUCKET_NAME,
      Key: key,
    })

    const signedUrl = await getSignedUrl(s3, command, { expiresIn: 3600 })

    res.status(200).json({
      downloadUrl: signedUrl,
    })
  } catch (err) {
    next(err)
  }
})

export default router
