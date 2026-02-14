import { createError } from "../err.js"
import Video from "../models/Video.js"
import User from "../models/User.js"

export const addVideo = async (req, res, next) => {
    const newVideo = new Video({userId: req.user.id, ...req.body})
    try {
        const savedVideo = await newVideo.save()
        res.status(200).json(savedVideo)
    } catch (err) {
        next(err)
    }
}

export const updateVideo = async (req, res, next) => {
    try {
        const video = await Video.findById(req.params.id)
        if(!video) return next(createError(404, 'Video not found'))
        if(req.user.id === video.userId) {
            const updatedVideo = await Video.findByIdAndUpdate(req.params.id, {
                $set: req.body
            },
            {new: true}
            )
            res.status(200).json(updatedVideo)
        } else {
            return next(createError(403, 'You can update only your video'))
        }
    } catch (err) {
        next(err)
    }
}

export const deleteVideo = async (req, res, next) => {
    try {
        const video = await Video.findById(req.params.id)
        if(!video) return next(createError(404, 'Video not found'))
        if(req.user.id === video.userId) {
            await Video.findByIdAndDelete(req.params.id)
            res.status(200).json('The video has been deleted')
        } else {
            return next(createError(403, 'You can delete only your video'))
        }
    } catch (err) {
        next(err)
    }
}

export const getVideo = async (req, res, next) => {
    try {
        const video = await Video.findById(req.params.id)
        res.status(200).json(video)
    } catch (err) {
        next(err)
    }
}

export const addViews = async (req, res, next) => {
    try {
    const video = await Video.findByIdAndUpdate(
      req.params.id,
      { $inc: { views: 1 } }, // incrementa views del video
      { new: true }
    );

    if (video) {
      // 🔹 Incrementar también las views del usuario dueño
      await User.findByIdAndUpdate(video.userId, { $inc: { totalViews: 1 } });
    }

    res.status(200).json("The view has been increased.");
  } catch (err) {
    next(err);
  }
}

// export const random = async (req, res, next) => {
//     try {
//         const videos = await Video.aggregate([{$sample: {size:15}}])
//         res.status(200).json(videos)
//     } catch (err) {
//         next(err)
//     }
// }

// Nuevo código de backend
export const random = async (req, res, next) => {
  const limit = 15;

  try {
    // Usamos $sample para obtener un conjunto aleatorio de videos
    const videos = await Video.aggregate([{ $sample: { size: limit } }]);

    res.status(200).json(videos);
  } catch (err) {
    next(err);
  }
};

export const trend = async (req, res, next) => {
    try {
        const videos = await Video.find().sort({views: -1}).limit(10)
        res.status(200).json(videos)
    } catch (err) {
        next(err)
    }
}

export const foll = async (req, res, next) => {
    try {
        const user = await User.findById(req.user.id)
        const followChannels = user.followsProfile

        const list = await Promise.all(
            followChannels.map(channelId => {
                return Video.find({userId: channelId})
            })
        )
        res.status(200).json(list.flat().sort((a,b) => b.createdAt - a.createdAt))
    } catch (err) {
        next(err)
    }
}

export const videoFavs = async (req, res, next) => {
    try {
        // Obtenemos el usuario actual
        const userId = req.user.id;

        // Buscamos los videos que el usuario ha marcado como favoritos
        const videosFavoritos = await Video.find({ likes: userId });

        res.status(200).json(videosFavoritos);
    } catch (err) {
        next(err);
    }
}

export const videoFilmLibrary = async (req, res, next) => {
    try {
        // Obtenemos el usuario actual
        const user = req.user.id;

        // Buscamos los videos que el usuario ha marcado como favoritos
        const videosProfile = await Video.find({ userId: user });

        res.status(200).json(videosProfile);
    } catch (err) {
        next(err);
    }
}

export const getByTag = async (req, res, next) => {
    const tags = req.query.tags.split(',')
    try {
        const videos = await Video.find({tags:{$in:tags}}).limit(20)
        res.status(200).json(videos)
    } catch (err) {
        next(err)
    }
}

export const search = async (req, res, next) => {
    const query  = req.query.q
    try {
        const videos = await Video.find({title:{$regex: query, $options: 'i'}}).limit(40)
        res.status(200).json(videos)
    } catch (err) {
        next(err)
    }
}

export const getVideosByUser = async (req, res, next) => {
    try {
        const { slug } = req.params;
        
        // Primero obtener el usuario por slug
        const user = await User.findOne({ slug });
        if (!user) {
            return res.status(404).json({ message: "Usuario no encontrado" });
        }
        
        const videos = await Video.find({ userId: user._id.toString() }).sort({ createdAt: -1 });
        
        res.status(200).json(videos);
    } catch (err) {
        next(err);
    }
}
//   try {
//     const userId = req.params.userId;

//     // Asegurar que el ID es ObjectId
//     const objectId = new mongoose.Types.ObjectId(userId);

//     // Usar aggregate para sumar views en la BD
//     const result = await Video.aggregate([
//       { $match: { userId: objectId } },
//       { $group: { _id: null, totalViews: { $sum: "$views" } } }
//     ]);

//     const totalViews = result.length > 0 ? result[0].totalViews : 0;

//     await User.findByIdAndUpdate(
//       userId,
//       { $set: { totalViews } },
//       { new: true }
//     );

//     res.status(200).json({ userId, totalViews });
//   } catch (err) {
//     next(err);
//   }
// };

export const getTopLikedVideos = async (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit) || 10; // Puedes enviar un parámetro para limitar resultados
    const videos = await Video.aggregate([
        { $addFields: { likesCount: { $size: "$likes" } } },
        { $sort: { likesCount: -1 } },
        { $limit: limit }
    ]);
    res.status(200).json(videos);
  } catch (err) {
    next(err);
  }
}


export const getTopDislikedVideos = async (req, res, next) => {
    try {
    const limit = parseInt(req.query.limit) || 10; // Puedes enviar un parámetro para limitar resultados
    const videos = await Video.aggregate([
        { $addFields: { dislikesCount: { $size: "$dislikes" } } },
        { $sort: { dislikesCount: -1 } },
        { $limit: limit }
    ]);
    res.status(200).json(videos);
  } catch (err) {
    next(err);
  }
}