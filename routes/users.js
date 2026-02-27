import express from 'express';
import { deleteUser, dislike, follow, getUser, getUserTotalViews, like, notDislike, notLike, searchUsers, unfollow, updateUser, updateUserTotalViews, getTopFollowedUsers, getFollowingUsers } from "../controllers/user.js";
import { verifyToken } from '../verifyToken.js';
import { addVideoToHistory, getHistory, deleteHistory, clearHistory } from "../controllers/history.js";
import { createPlaylist, getPlaylists, getPlaylist, updatePlaylist, deletePlaylist, addVideoToPlaylist, removeVideoFromPlaylist } from "../controllers/playlist.js";

const router = express.Router()

// get a user - DEBE IR ANTES de las rutas con :id/:userId
router.get('/find/:slug', getUser)

// update user
router.put('/:id', verifyToken, updateUser)

router.get('/search', searchUsers)

// top followed users
router.get('/top-followed', getTopFollowedUsers)

// following users
router.get('/following/:id', verifyToken, getFollowingUsers)

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

// History routes
router.post('/history', verifyToken, addVideoToHistory)
router.get('/history/:userId', getHistory)
router.delete('/history/:userId/:historyId', verifyToken, deleteHistory)
router.delete('/history/:userId', verifyToken, clearHistory)

// Playlist routes
router.post('/playlists', verifyToken, createPlaylist)
router.get('/playlists/:userId', getPlaylists)
router.get('/playlists/:userId/:playlistId', getPlaylist)
router.put('/playlists/:userId/:playlistId', verifyToken, updatePlaylist)
router.delete('/playlists/:userId/:playlistId', verifyToken, deletePlaylist)
router.put('/playlists/:userId/:playlistId/:videoId', verifyToken, addVideoToPlaylist)
router.delete('/playlists/:userId/:playlistId/:videoId', verifyToken, removeVideoFromPlaylist)

export default router