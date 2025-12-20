import { createError } from "../err.js"
import User from '../models/User.js'
import Video from "../models/Video.js"

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
            await User.findByIdAndDelete(req.params.id, )
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
        const user = await User.findById(req.params.id)
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
        res.status(200).json('The video has been like')
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
    const { userId } = req.params;

    const result = await Video.aggregate([
      { $match: { userId: userId } }, 
      { $group: { _id: null, totalViews: { $sum: "$views" } } }
    ]);

    const totalViews = result.length > 0 ? result[0].totalViews : 0;

    const updatedUser = await User.findByIdAndUpdate(
      userId, // Aquí sí es ObjectId porque corresponde al _id del User
      { $set: { totalViews } },
      { new: true }
    );

    if (!updatedUser) {
      return res.status(404).json({ message: "Usuario no encontrado" });
    }

    res.status(200).json({ userId, totalViews });
  } catch (err) {
    console.error("🔥 Error en updateUserTotalViews:", err);
    res.status(500).json({ message: "Error server", error: err.message });
  }
};

// 🔹 Solo obtener el totalViews actual del usuario
export const getUserTotalViews = async (req, res, next) => {
  try {
    const user = await User.findById(req.params.userId);
    res.status(200).json({ totalViews: user?.totalViews || 0 });
  } catch (err) {
    next(err);
  }
};