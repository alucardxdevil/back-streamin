import express from 'express';
import { addComment, deleteComment, editComment, getComments } from "../controllers/comment.js";
import {verifyToken} from "../verifyToken.js"
import { sanitizeCommentInput } from "../middleware/sanitizer.js";

const router = express.Router()

// Crear comentario - con sanitización
router.post('/', verifyToken, sanitizeCommentInput, addComment)

// Editar comentario - con sanitización
router.put('/:id', verifyToken, sanitizeCommentInput, editComment)

// Eliminar comentario
router.delete('/:id', verifyToken, deleteComment)

// Obtener comentarios de un video (público)
router.get('/:videoId', getComments)

export default router
