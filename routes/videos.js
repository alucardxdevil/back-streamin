import express from 'express';
import { addVideo, addViews, deleteVideo, foll, getByTag, getTopDislikedVideos, getTopLikedVideos, getVideo, getVideosByUser, random, search, trend, updateVideo, videoFavs, videoFilmLibrary, getRecentVideos } from "../controllers/video.js";
import { verifyToken } from '../verifyToken.js';
import { sanitizeVideoInput } from '../middleware/sanitizer.js';

const router = express.Router()

// create video - con sanitización
router.post('/', verifyToken, sanitizeVideoInput, addVideo)

// update video - con sanitización
router.put('/:id', verifyToken, sanitizeVideoInput, updateVideo)

// delete video
router.delete('/:id', verifyToken, deleteVideo)

// get video by id
router.get('/find/:id', getVideo)

// add view (público, no necesita sanitización)
router.put('/view/:id', addViews)

// tendencias (público)
router.get('/trend', trend)
router.get('/random', random)

// seguidos (requiere auth)
router.get('/foll', verifyToken, foll)
router.get('/fav', verifyToken, videoFavs)
router.get('/filmlibrary', verifyToken, videoFilmLibrary)

// búsqueda (público)
router.get('/second/:slug', getVideosByUser)
router.get('/tags', getByTag)
router.get('/search', search)
router.get('/top-liked', getTopLikedVideos);
router.get('/top-disliked', getTopDislikedVideos);
router.get('/recent', getRecentVideos);

export default router
