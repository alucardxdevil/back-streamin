import { createError } from "../err.js";
import Playlist from "../models/Playlist.js";
import Video from "../models/Video.js";
import mongoose from "mongoose";

export const createPlaylist = async (req, res, next) => {
    try {
        const { userId, name, description, videoIds } = req.body;
        
        // Si videoIds es un array, usarlo; si es un solo videoId, convertirlo a array
        const videoIdList = videoIds ? (Array.isArray(videoIds) ? videoIds : [videoIds]) : [];
        
        // Verificar si ya existe una playlist con el mismo nombre y eliminarla
        const existingPlaylist = await Playlist.findOne({
            userId,
            name
        });
        
        if (existingPlaylist) {
            await Playlist.findByIdAndDelete(existingPlaylist._id);
        }
        
        // Obtener los videos completos para crear la lista de videos
        const videosData = [];
        for (const videoId of videoIdList) {
            const video = await Video.findById(videoId);
            if (video) {
                videosData.push({
                    videoId: new mongoose.Types.ObjectId(videoId),
                    videoTitle: video.title,
                    videoDuration: video.duration
                });
            }
        }
        
        // Crear nueva playlist
        const newPlaylistData = {
            userId,
            name,
            description,
            videos: videosData
        };
        
        const newPlaylist = new Playlist(newPlaylistData);
        await newPlaylist.save();
        
        res.status(201).json({ message: "Playlist creada", playlist: newPlaylist });
    } catch (err) {
        next(err);
    }
};

export const getPlaylists = async (req, res, next) => {
    try {
        const { userId } = req.params;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;
        
        const playlists = await Playlist.find({ userId })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .populate(
                {
                    path: "videos.videoId",
                    select: "title description imgUrl videoUrl duration tags"
                }
            );
        
        const total = await Playlist.countDocuments({ userId });
        
        res.status(200).json({
            playlists,
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

export const getPlaylist = async (req, res, next) => {
    try {
        const { userId, playlistId } = req.params;
        
        const playlist = await Playlist.findOne({
            _id: playlistId,
            userId
        })
        .populate(
            {
                path: "videos.videoId",
                select: "title description imgUrl videoUrl duration tags"
            }
        );
        
        if (!playlist) {
            return next(createError(404, "Playlist no encontrada"));
        }
        
        res.status(200).json(playlist);
    } catch (err) {
        next(err);
    }
};

/**
 * Get a shared playlist by playlistId only (no userId required).
 * Used for shared links where the viewer may not know the owner's userId.
 * Returns the playlist with populated video data.
 */
export const getSharedPlaylist = async (req, res, next) => {
    try {
        const { playlistId } = req.params;
        
        const playlist = await Playlist.findById(playlistId)
            .populate({
                path: "videos.videoId",
                select: "title description imgUrl videoUrl duration tags"
            });
        
        if (!playlist) {
            return next(createError(404, "Playlist no encontrada"));
        }
        
        res.status(200).json(playlist);
    } catch (err) {
        next(err);
    }
};

export const updatePlaylist = async (req, res, next) => {
    try {
        const { userId, playlistId } = req.params;
        const { name, description } = req.body;
        
        const playlist = await Playlist.findOneAndUpdate({
            _id: playlistId,
            userId
        }, {
            name,
            description,
            updatedAt: new Date()
        }, { new: true });
        
        if (!playlist) {
            return next(createError(404, "Playlist no encontrada"));
        }
        
        res.status(200).json({ message: "Playlist actualizada", playlist });
    } catch (err) {
        next(err);
    }
};

export const deletePlaylist = async (req, res, next) => {
    try {
        const { userId, playlistId } = req.params;
        
        await Playlist.findOneAndDelete({
            _id: playlistId,
            userId
        });
        
        res.status(200).json({ message: "Playlist eliminada" });
    } catch (err) {
        next(err);
    }
};

export const addVideoToPlaylist = async (req, res, next) => {
    try {
        const { userId, playlistId, videoId } = req.params;
        
        // Verificar que el video existe
        const video = await Video.findById(videoId);
        if (!video) {
            return next(createError(404, "Video no encontrado"));
        }
        
        // Verificar que la playlist existe y pertenece al usuario
        const playlist = await Playlist.findOne({
            _id: playlistId,
            userId
        });
        
        if (!playlist) {
            return next(createError(404, "Playlist no encontrada"));
        }
        
        // Verificar si el video ya está en la playlist
        const videoExists = playlist.videos.some(v => v.videoId.toString() === videoId);
        if (videoExists) {
            return next(createError(400, "El video ya está en la playlist"));
        }
        
        // Agregar video a la playlist
        await Playlist.findByIdAndUpdate(playlistId, {
            $push: {
                videos: {
                    videoId,
                    videoTitle: video.title,
                    videoDuration: video.duration
                }
            },
            $set: { updatedAt: new Date() }
        });
        
        res.status(200).json({ message: "Video agregado a la playlist" });
    } catch (err) {
        next(err);
    }
};

export const removeVideoFromPlaylist = async (req, res, next) => {
    try {
        const { userId, playlistId, videoId } = req.params;
        
        await Playlist.findByIdAndUpdate(playlistId, {
            $pull: {
                videos: {
                    videoId
                }
            }
        });
        
        res.status(200).json({ message: "Video eliminado de la playlist" });
    } catch (err) {
        next(err);
    }
};