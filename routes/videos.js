import express from 'express';
import { addVideo, addViews, deleteVideo, foll, getByTag, getTopDislikedVideos, getTopLikedVideos, getVideo, getVideosByUser, random, search, trend, updateVideo, videoFavs, videoFilmLibrary } from "../controllers/video.js";
import { verifyToken } from '../verifyToken.js';

const router = express.Router()

// create video
router.post('/', verifyToken, addVideo)
router.delete('/:id', verifyToken, deleteVideo)
router.put('/:id', verifyToken, updateVideo)
router.get('/find/:id', getVideo)
router.put('/view/:id', addViews)
router.get('/trend', trend)
router.get('/random', random)
router.get('/foll', verifyToken, foll)
router.get('/fav', verifyToken, videoFavs)
router.get('/filmlibrary', verifyToken, videoFilmLibrary)
router.get('/second/:slug', getVideosByUser)
router.get('/tags', getByTag)
router.get('/search', search)
router.get('/top-liked', getTopLikedVideos);
router.get('/top-disliked', getTopDislikedVideos);
// router.get("/:userId/total-views", getUserTotalViews);
// router.put('/:userId/update-total-views', updateUserTotalViews)

export default router

