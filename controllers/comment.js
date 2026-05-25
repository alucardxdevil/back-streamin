import { createError } from "../err.js"
import Comment from "../models/Comments.js"
import Video from "../models/Video.js"
import User from "../models/User.js"

async function enrichCommentsWithUsers(comments) {
    const userIds = [...new Set(comments.map((c) => c.userId).filter(Boolean))]
    if (userIds.length === 0) {
        return comments.map((c) => ({
            ...c,
            userName: null,
            userImg: null,
            userSlug: null,
        }))
    }

    const users = await User.find({
        _id: { $in: userIds },
        isDeleted: { $ne: true },
    })
        .select('name slug img')
        .lean()

    const userMap = new Map(users.map((u) => [String(u._id), u]))

    return comments.map((c) => {
        const user = userMap.get(String(c.userId))
        return {
            ...c,
            userName: user?.name ?? 'Usuario',
            userImg: user?.img ?? null,
            userSlug: user?.slug ?? null,
        }
    })
}

export const addComment = async (req, res, next) => {
    const newComment = new Comment({...req.body, userId:req.user.id})
    try {
        const savedComment = await newComment.save()
        const [enriched] = await enrichCommentsWithUsers([
            savedComment.toObject ? savedComment.toObject() : savedComment,
        ])
        res.status(200).send(enriched)
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
        const [enriched] = await enrichCommentsWithUsers([
            updatedComment.toObject ? updatedComment.toObject() : updatedComment,
        ])
        res.status(200).json(enriched)
    } catch (err) {
        next(err)
    }
}

export const getComments = async (req, res, next) => {
    try {
        const comments = await Comment.find({
            videoId: req.params.videoId,
            $or: [
                { moderationStatus: { $exists: false } },
                { moderationStatus: 'approved' },
            ],
        }).sort({ createdAt: -1 }).lean()

        const enriched = await enrichCommentsWithUsers(comments)
        res.status(200).json(enriched)
    } catch (err) {
        next(err)
    }
}