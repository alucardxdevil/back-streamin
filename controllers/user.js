import { createError } from "../err.js"
import User from '../models/User.js'
import Video from "../models/Video.js"
import Playlist from "../models/Playlist.js"
import mongoose from "mongoose"

export const updateUser = async (req, res, next) => {
    if(req.params.id === req.user.id) {
        try {
            const updateUser = await User.findByIdAndUpdate(req.params.id, {
                $set:req.body
            },
            {new: true}
            )
            res.status(200).json(updateUser)
        } catch (err) {
            next(err)
        }
    } else {
        return next(createError(403, 'You can update only your account'))
    }
}

export const deleteUser = async (req, res, next) => {
    if(req.params.id === req.user.id) {
        try {
            // Soft delete: marcar como eliminado en lugar de borrar
            // Esto invalidará la sesión pero mantendrá datos para auditoría
            await User.findByIdAndUpdate(req.params.id, {
                $set: { 
                    isDeleted: true,
                    deletedAt: new Date(),
                    // Invalidar email para que no pueda usarse en registro hasta que expire el token de reseteo
                    email: `deleted_${Date.now()}_${req.params.id}@deleted.stream-in.com`,
                    // Limpiar datos sensibles
                    password: 'DELETED',
                    passwordResetTokenHash: null,
                    passwordResetExpires: null
                }
            })
            res.status(200).json('User has been deleted')
        } catch (err) {
            next(err)
        }
    } else {
        return next(createError(403, 'You can delete only your account'))
    }
}

export const getUser = async (req, res, next) => {
    try {
        const { slug } = req.params;
        
        // Primero intentar buscar por slug
        let user = await User.findOne({ slug });
        
        // Si no encuentra por slug, intentar por _id (para compatibilidad)
        if (!user) {
            user = await User.findById(slug);
        }
        
        if (!user) {
            return res.status(404).json({ message: "Usuario no encontrado" });
        }
        
        res.status(200).json(user)
    } catch (err) {
        next(err)
    }
}

export const searchUsers = async (req, res, next) => {
    const query  = req.query.q
    try {
        const user = await User.find({name:{$regex: query, $options: 'i'}}).limit(10)
        res.status(200).json(user)
    } catch (err) {
        next(err)
    }
}

export const follow = async (req, res, next) => {
    try {
        await User.findByIdAndUpdate(req.user.id, {
            $push: {followsProfile: req.params.id}
        })
        await User.findByIdAndUpdate(req.params.id, {
            $inc: {follows: 1}
        })
        res.status(200).json('Follows successfull')
    } catch (err) {
        next(err)
    }
}

export const unfollow = async (req, res, next) => {
    try {
        await User.findByIdAndUpdate(req.user.id, {
            $pull: {followsProfile: req.params.id}
        })
        await User.findByIdAndUpdate(req.params.id, {
            $inc: {follows: -1}
        })
        res.status(200).json('Unfollows successfull')
    } catch (err) {
        next(err)
    }
}

export const like = async (req, res, next) => {
    const id = req.user.id
    const videoId = req.params.videoId
    try {
        await Video.findByIdAndUpdate(videoId, {
            $addToSet:{likes:id},
            $pull:{dislikes:id}
        })
        
        // Agregar video a la playlist de favoritos
        const video = await Video.findById(videoId);
        if (video) {
            // Buscar si ya existe la playlist de favoritos
            let favPlaylist = await Playlist.findOne({
                userId: id,
                name: 'Mis videos favoritos'
            });
            
            if (!favPlaylist) {
                // Crear la playlist si no existe
                favPlaylist = new Playlist({
                    userId: id,
                    name: 'Mis videos favoritos',
                    description: 'Videos que te han gustado',
                    videos: [{
                        videoId: new mongoose.Types.ObjectId(videoId),
                        videoTitle: video.title,
                        videoDuration: video.duration
                    }]
                });
                await favPlaylist.save();
            } else {
                // Verificar si el video ya está en la playlist
                const videoExists = favPlaylist.videos.some(
                    v => v.videoId.toString() === videoId
                );
                if (!videoExists) {
                    favPlaylist.videos.push({
                        videoId: new mongoose.Types.ObjectId(videoId),
                        videoTitle: video.title,
                        videoDuration: video.duration
                    });
                    favPlaylist.updatedAt = new Date();
                    await favPlaylist.save();
                }
            }
        }
        
        res.status(200).json('The video has been like')
    } catch (err) {
        next(err)
    }
}

export const notLike = async (req, res, next) => {
    const id = req.user.id
    const videoId = req.params.videoId
    try {
        await Video.findByIdAndUpdate(videoId, {
            $pull:{likes:id}
        })
        
        // Quitar video de la playlist de favoritos
        await Playlist.findOneAndUpdate(
            { userId: id, name: 'Mis videos favoritos' },
            {
                $pull: { videos: { videoId: new mongoose.Types.ObjectId(videoId) } },
                $set: { updatedAt: new Date() }
            }
        );
        
        res.status(200).json('The video has been unliked')
    } catch (err) {
        next(err)
    }
}

export const dislike = async (req, res, next) => {
    const id = req.user.id
    const videoId = req.params.videoId
    try {
        await Video.findByIdAndUpdate(videoId, {
            $addToSet:{dislikes:id},
            $pull:{likes:id}
        })
        res.status(200).json('The video has been dislike')
    } catch (err) {
        next(err)
    }
}

export const notDislike = async (req, res, next) => {
    const id = req.user.id
    const videoId = req.params.videoId
    try {
        await Video.findByIdAndUpdate(videoId, {
            $pull:{dislikes:id}
        })
        res.status(200).json('The video has been notdislike')
    } catch (err) {
        next(err)
    }
}

export const updateUserTotalViews = async (req, res, next) => {
  try {
    const { slug } = req.params;

    // Primero obtener el usuario por slug para obtener su _id
    const user = await User.findOne({ slug });
    if (!user) {
      return res.status(404).json({ message: "Usuario no encontrado" });
    }

    const result = await Video.aggregate([
      { $match: { userId: user._id.toString() } }, 
      { $group: { _id: null, totalViews: { $sum: "$views" } } }
    ]);

    const totalViews = result.length > 0 ? result[0].totalViews : 0;

    await User.findByIdAndUpdate(
      user._id,
      { $set: { totalViews } },
      { new: true }
    );

    res.status(200).json({ slug, totalViews });
  } catch (err) {
    console.error("🔥 Error en updateUserTotalViews:", err);
    res.status(500).json({ message: "Error server", error: err.message });
  }
};

// 🔹 Solo obtener el totalViews actual del usuario
export const getUserTotalViews = async (req, res, next) => {
  try {
    const { slug } = req.params;
    const user = await User.findOne({ slug });
    if (!user) {
      return res.status(404).json({ message: "Usuario no encontrado" });
    }
    res.status(200).json({ totalViews: user?.totalViews || 0 });
  } catch (err) {
    next(err);
  }
};

// 🔹 Obtener los usuarios más seguidos
export const getTopFollowedUsers = async (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const users = await User.find({})
      .sort({ follows: -1 })
      .limit(limit)
      .select('-password -email');
    res.status(200).json(users);
  } catch (err) {
    next(err);
  }
};

// 🔹 Obtener los perfiles que sigue el usuario
export const getFollowingUsers = async (req, res, next) => {
  try {
    const userId = req.params.id;
    
    // Buscar el usuario para obtener su lista de followsProfile
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "Usuario no encontrado" });
    }
    
    const followingIds = user.followsProfile || [];
    
    if (followingIds.length === 0) {
      return res.status(200).json([]);
    }
    
    // Obtener los datos de los usuarios seguidos
    const followingUsers = await User.find({
      _id: { $in: followingIds }
    }).select('-password -email');
    
    res.status(200).json(followingUsers);
  } catch (err) {
    next(err);
  }
};