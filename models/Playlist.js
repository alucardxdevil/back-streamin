import mongoose from "mongoose";

const PlaylistSchema = new mongoose.Schema({
    userId: {
        type: String,
        required: true,
    },
    name: {
        type: String,
        required: true,
    },
    description: {
        type: String,
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