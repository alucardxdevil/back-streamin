import express from 'express';
import { deleteUser, dislike, follow, getUser, getUserTotalViews, like, notDislike, notLike, searchUsers, unfollow, updateUser, updateUserTotalViews, getTopFollowedUsers, getFollowingUsers } from "../controllers/user.js";
import { verifyToken } from '../verifyToken.js';
import { addVideoToHistory, getHistory, deleteHistory, clearHistory } from "../controllers/history.js";
import { createPlaylist, getPlaylists, getPlaylist, getSharedPlaylist, updatePlaylist, deletePlaylist, addVideoToPlaylist, removeVideoFromPlaylist, removePlaylistItem } from "../controllers/playlist.js";
import { requireOwnership, requireUserOwnership } from "../middleware/ownership.js";
import { sanitizeUserInput, sanitizePlaylistInput } from "../middleware/sanitizer.js";

const router = express.Router()

// get a user - DEBE IR ANTES de las rutas con :id/:userId
router.get('/find/:slug', getUser)

// update user - con sanitización
router.put('/:id', verifyToken, requireUserOwnership('id'), sanitizeUserInput, updateUser)

// delete user - verificar que el usuario autenticado es el mismo que se elimina
router.delete('/:id', verifyToken, requireUserOwnership('id'), deleteUser)

router.get('/search', searchUsers)

// top followed users
router.get('/top-followed', getTopFollowedUsers)

// following users
router.get('/following/:id', verifyToken, requireOwnership('id', 'userId'), getFollowingUsers)

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

// History routes - todas requieren que el usuario autenticado sea el mismo que userId
router.post('/history', verifyToken, addVideoToHistory)
router.get('/history/:userId', verifyToken, requireOwnership('userId', 'userId'), getHistory)
router.delete('/history/:userId/:historyId', verifyToken, requireOwnership('userId', 'userId'), deleteHistory)
router.delete('/history/:userId', verifyToken, requireOwnership('userId', 'userId'), clearHistory)

// Playlist routes - con sanitización
router.post('/playlists', verifyToken, sanitizePlaylistInput, createPlaylist)
router.get('/playlists/shared/:playlistId', getSharedPlaylist) // Public shared playlist (no userId needed)
router.get('/playlists/:userId', verifyToken, requireOwnership('userId', 'userId'), getPlaylists)
router.get('/playlists/:userId/:playlistId', verifyToken, requireOwnership('userId', 'userId'), getPlaylist)
router.put('/playlists/:userId/:playlistId', verifyToken, requireOwnership('userId', 'userId'), sanitizePlaylistInput, updatePlaylist)
router.delete('/playlists/:userId/:playlistId', verifyToken, requireOwnership('userId', 'userId'), deletePlaylist)
router.put('/playlists/:userId/:playlistId/:videoId', verifyToken, requireOwnership('userId', 'userId'), addVideoToPlaylist)
router.delete('/playlists/:userId/:playlistId/:videoId', verifyToken, requireOwnership('userId', 'userId'), removeVideoFromPlaylist)
router.delete('/playlists/:userId/:playlistId/item/:itemId', verifyToken, requireOwnership('userId', 'userId'), removePlaylistItem)

export default router
