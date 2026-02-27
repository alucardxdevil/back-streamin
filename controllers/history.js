import { createError } from "../err.js";
import History from "../models/History.js";
import Video from "../models/Video.js";

export const addVideoToHistory = async (req, res, next) => {
    try {
        const { userId, videoId, videoTitle, videoDuration } = req.body;
        
        // Verificar que el video existe
        const video = await Video.findById(videoId);
        if (!video) {
            return next(createError(404, "Video no encontrado"));
        }
        
        // Verificar si ya existe en el historial
        const existingHistory = await History.findOne({
            userId,
            videoId
        });
        
        if (existingHistory) {
            // Si ya existe, actualizar la fecha de visualización
            await History.findByIdAndUpdate(existingHistory._id, {
                viewedAt: new Date()
            });
        } else {
            // Si no existe, crear nuevo registro
            const newHistory = new History({
                userId,
                videoId,
                videoTitle,
                videoDuration,
                imgUrl: video.imgUrl
            });
            await newHistory.save();
        }
        
        res.status(200).json({ message: "Video agregado al historial" });
    } catch (err) {
        next(err);
    }
};

export const getHistory = async (req, res, next) => {
    try {
        const { userId } = req.params;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;
        
        const history = await History.find({ userId })
            .sort({ viewedAt: -1 })
            .skip(skip)
            .limit(limit)
            .populate(
                {
                    path: "videoId",
                    select: "title description imgUrl videoUrl duration tags"
                }
            );
        
        const total = await History.countDocuments({ userId });
        
        res.status(200).json({
            history,
            pagination: {
                page,
                limit,
                total,
                pages: Math.ceil(total / limit)
            }
        });
    } catch (err) {
        next(err);
    }
};

export const deleteHistory = async (req, res, next) => {
    try {
        const { userId, historyId } = req.params;
        
        await History.findOneAndDelete({
            _id: historyId,
            userId
        });
        
        res.status(200).json({ message: "Registro eliminado del historial" });
    } catch (err) {
        next(err);
    }
};

export const clearHistory = async (req, res, next) => {
    try {
        const { userId } = req.params;
        
        await History.deleteMany({ userId });
        
        res.status(200).json({ message: "Historial eliminado" });
    } catch (err) {
        next(err);
    }
};