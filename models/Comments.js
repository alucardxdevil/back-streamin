import mongoose from "mongoose";

const COMMENT_MAX_LENGTH = 2000;

const CommentSchema = new mongoose.Schema({
    userId: {
        type: String,
        required: true,
    },
    videoId: {
        type: String,
        required: true,
    },
    descriptionC: {
        type: String,
        required: true,
        maxlength: [COMMENT_MAX_LENGTH, `El comentario no puede exceder ${COMMENT_MAX_LENGTH} caracteres`],
        trim: true,
    },
},
{
    timestamps: true
}
)

export default mongoose.model('Comment', CommentSchema)