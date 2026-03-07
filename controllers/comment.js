import { createError } from "../err.js"
import Comment from "../models/Comments.js"
import Video from "../models/Video.js"

export const addComment = async (req, res, next) => {
    const newComment = new Comment({...req.body, userId:req.user.id})
    try {
        const savedComment = await newComment.save()
        res.status(200).send(savedComment)
    } catch (err) {
        next(err)
    }
}

export const deleteComment = async (req, res, next) => {
    try {
        const comment = await Comment.findById(req.params.id)
        const video = await Video.findById(comment.videoId)
        if(req.user.id === comment.userId || (video && req.user.id === video.userId)) {
            await Comment.findByIdAndDelete(req.params.id)
            res.status(200).json('The comment has been deleted')
        } else {
            return next(createError(403, 'You can deleted only your comment'))
        }
    } catch (err) {
        next(err)
    }
}

// Editar un comentario: solo el autor puede modificarlo
export const editComment = async (req, res, next) => {
    try {
        const comment = await Comment.findById(req.params.id)
        if (!comment) return next(createError(404, 'Comment not found'))

        // Solo el autor del comentario puede editarlo
        if (req.user.id !== comment.userId) {
            return next(createError(403, 'You can only edit your own comment'))
        }

        const { descriptionC } = req.body
        if (!descriptionC || !descriptionC.trim()) {
            return next(createError(400, 'Comment text cannot be empty'))
        }

        const updatedComment = await Comment.findByIdAndUpdate(
            req.params.id,
            { $set: { descriptionC: descriptionC.trim() } },
            { new: true }
        )
        res.status(200).json(updatedComment)
    } catch (err) {
        next(err)
    }
}

export const getComments = async (req, res, next) => {
    try {
        const comments = await Comment.find({videoId:req.params.videoId})
        res.status(200).json(comments)
    } catch (err) {
        next(err)
    }
}