import express from 'express';
import { verifyPanelApiKey } from '../middleware/verifyPanelApiKey.js';
import {
  listPanelUsers,
  getPanelUser,
  patchPanelUser,
  deletePanelUser,
  listPanelVideoComments,
  addPanelVideoComment,
  deletePanelComment,
  patchPanelComment,
  patchPanelVideo,
  deletePanelVideo,
} from '../controllers/panel.js';

const router = express.Router();

router.use(verifyPanelApiKey);

router.get('/users', listPanelUsers);
router.get('/users/:id', getPanelUser);
router.patch('/users/:id', patchPanelUser);
router.delete('/users/:id', deletePanelUser);

router.patch('/videos/:id', patchPanelVideo);
router.delete('/videos/:id', deletePanelVideo);

router.get('/videos/:videoId/comments', listPanelVideoComments);
router.post('/videos/:videoId/comments', addPanelVideoComment);
router.delete('/comments/:id', deletePanelComment);
router.patch('/comments/:id', patchPanelComment);

export default router;
