import express from 'express';
import { verifyPanelApiKey } from '../middleware/verifyPanelApiKey.js';
import {
  listPanelUsers,
  getPanelUser,
  patchPanelUser,
  deletePanelUser,
  getPanelStats,
  listPanelVideos,
  getPanelVideo,
  getPanelInfrastructure,
  panelFlushViews,
  panelRetryTranscode,
  listPanelCommentsModeration,
  listPanelVideoComments,
  addPanelVideoComment,
  deletePanelComment,
  patchPanelComment,
  patchPanelVideo,
  deletePanelVideo,
} from '../controllers/panel.js';

const router = express.Router();

router.use(verifyPanelApiKey);

router.get('/stats', getPanelStats);
router.get('/infrastructure', getPanelInfrastructure);
router.post('/views/flush', panelFlushViews);
router.post('/transcode/retry/:videoId', panelRetryTranscode);

router.get('/users', listPanelUsers);
router.get('/users/:id', getPanelUser);
router.patch('/users/:id', patchPanelUser);
router.delete('/users/:id', deletePanelUser);

router.get('/videos', listPanelVideos);
router.get('/videos/:videoId/comments', listPanelVideoComments);
router.post('/videos/:videoId/comments', addPanelVideoComment);
router.get('/videos/:id', getPanelVideo);
router.patch('/videos/:id', patchPanelVideo);
router.delete('/videos/:id', deletePanelVideo);

router.get('/comments', listPanelCommentsModeration);
router.delete('/comments/:id', deletePanelComment);
router.patch('/comments/:id', patchPanelComment);

export default router;
