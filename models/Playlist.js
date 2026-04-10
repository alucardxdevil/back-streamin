import mongoose from "mongoose";

const PLAYLIST_NAME_MAX = 100;
const PLAYLIST_DESC_MAX = 500;

const PlaylistSchema = new mongoose.Schema({
    userId: {
        type: String,
        required: true,
    },
    name: {
        type: String,
        required: true,
        maxlength: [PLAYLIST_NAME_MAX, `El nombre no puede exceder ${PLAYLIST_NAME_MAX} caracteres`],
        trim: true,
        validate: {
            validator: function(v) {
                return v && v.trim().length > 0;
            },
            message: 'El nombre no puede estar vacío'
        }
    },
    description: {
        type: String,
        maxlength: [PLAYLIST_DESC_MAX, `La descripción no puede exceder ${PLAYLIST_DESC_MAX} caracteres`],
        default: ''
    },
    videos: [{
        videoId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Video',
            required: true,
        },
        videoTitle: {
            type: String,
            required: true,
            maxlength: 200
        },
        videoDuration: {
            type: String,
            required: true,
        },
        addedAt: {
            type: Date,
            default: Date.now,
        },
    }],
    createdAt: {
        type: Date,
        default: Date.now,
    },
    updatedAt: {
        type: Date,
        default: Date.now,
    },
},
{
    timestamps: true
}
)

PlaylistSchema.pre("save", function(next) {
    this.updatedAt = new Date();
    next();
});

export default mongoose.model('Playlist', PlaylistSchema);