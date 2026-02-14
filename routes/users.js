import express from 'express';
import { deleteUser, dislike, follow, getUser, getUserTotalViews, like, notDislike, notLike, searchUsers, unfollow, updateUser, updateUserTotalViews } from "../controllers/user.js";
import { verifyToken } from '../verifyToken.js';

const router = express.Router()

// get a user - DEBE IR ANTES de las rutas con :id/:userId
router.get('/find/:slug', getUser)

// update user
router.put('/:id', verifyToken, updateUser)

router.get('/search', searchUsers)

// follow user
router.put('/fol/:id', verifyToken, follow)

// unfollow user
router.put('/unfol/:id', verifyToken, unfollow)

// like a video
router.put('/like/:videoId', verifyToken, like)
router.put('/notlike/:videoId', verifyToken, notLike)

//dislake a video
router.put('/dislike/:videoId', verifyToken, dislike)
router.put('/notdislike/:videoId', verifyToken, notDislike)

// Totalviews - actualizados para usar slug
router.put("/:slug/update-total-views", updateUserTotalViews);
router.get("/:slug/total-views", getUserTotalViews);


export default router