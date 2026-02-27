import mongoose from "mongoose";

const HistorySchema = new mongoose.Schema({
    userId: {
        type: String,
        required: true,
    },
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
    imgUrl: {
        type: String,
    },
    viewedAt: {
        type: Date,
        default: Date.now,
    },
},
{
    timestamps: true
}
)

export default mongoose.model('History', HistorySchema);