import mongoose from 'mongoose';
import slugify from 'slugify';
import { createError } from '../err.js';
import User from '../models/User.js';
import Video from '../models/Video.js';
import Comment from '../models/Comments.js';
import { getQueueStats, enqueueTranscodeJob } from '../queues/transcodeQueue.js';
import { flushViews, getPendingViewsSummary } from '../services/viewCounter.js';
import { createRedisConnection } from '../config/redis.js';

const MONGO_STATES = ['disconnected', 'connected', 'connecting', 'disconnecting'];
const MONTH_NAMES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

function lastMonthsKeys(n = 6) {
  const keys = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return keys;
}

function monthOverMonthTrend(current, previous) {
  if (previous == null || previous === 0) return current > 0 ? 100 : null;
  return Math.round(((current - previous) / previous) * 100);
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripUser(u) {
  if (!u) return null;
  const o = typeof u.toObject === 'function' ? u.toObject() : { ...u };
  delete o.password;
  delete o.passwordResetTokenHash;
  delete o.passwordResetExpires;
  return {
    ...o,
    role: o.role || 'user',
    isBanned: Boolean(o.isBanned),
    bannedUntil: o.bannedUntil || null,
    banReason: o.banReason || '',
  };
}

/**
 * GET /api/panel/users — listado paginado para administración.
 */
export const listPanelUsers = async (req, res, next) => {
  try {
    const q = req.query.q != null ? String(req.query.q).trim() : '';
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const skip = (page - 1) * limit;

    const baseFilter = { isDeleted: { $ne: true } };
    const filter = { ...baseFilter };

    if (q) {
      filter.$or = [
        { name: { $regex: new RegExp(escapeRegex(q), 'i') } },
        { email: { $regex: new RegExp(escapeRegex(q), 'i') } },
      ];
    }

    if (req.query.isBanned === 'true') {
      filter.isBanned = true;
    } else if (req.query.isBanned === 'false') {
      filter.isBanned = { $ne: true };
    }

    const [items, total] = await Promise.all([
      User.find(filter)
        .select('-password -passwordResetTokenHash -passwordResetExpires')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      User.countDocuments(filter),
    ]);

    const users = items.map((u) => ({
      ...u,
      role: u.role || 'user',
      isBanned: Boolean(u.isBanned),
      bannedUntil: u.bannedUntil || null,
      banReason: u.banReason || '',
    }));

    res.status(200).json({ users, total, page, limit, pages: Math.ceil(total / limit) });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/panel/users/:id
 */
export const getPanelUser = async (req, res, next) => {
  try {
    const { id } = req.params;
    let user = await User.findOne({ _id: id, isDeleted: { $ne: true } })
      .select('-password -passwordResetTokenHash -passwordResetExpires')
      .lean();
    if (!user) {
      user = await User.findOne({ slug: id, isDeleted: { $ne: true } })
        .select('-password -passwordResetTokenHash -passwordResetExpires')
        .lean();
    }
    if (!user) {
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }
    res.status(200).json(stripUser(user));
  } catch (err) {
    next(err);
  }
};

/**
 * PATCH /api/panel/users/:id — actualización administrativa (rol, baneo, perfil).
 */
export const patchPanelUser = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return next(createError(400, 'ID de usuario inválido'));
    }

    const user = await User.findOne({ _id: id, isDeleted: { $ne: true } }).select('+tokenVersion');
    if (!user) {
      return next(createError(404, 'Usuario no encontrado'));
    }

    const { name, descriptionAccount, role, isBanned, bannedUntil, banReason } = req.body;
    const updates = {};

    if (typeof name === 'string' && name.trim()) {
      const taken = await User.findOne({
        name: { $regex: new RegExp(`^${escapeRegex(name.trim())}$`, 'i') },
        _id: { $ne: id },
      });
      if (taken) {
        return next(createError(400, 'El nombre de usuario ya está en uso'));
      }
      updates.name = name.trim();
      updates.slug = slugify(name.trim(), {
        lower: true,
        strict: true,
        trim: true,
      });
    }

    if (typeof descriptionAccount === 'string') {
      updates.descriptionAccount = descriptionAccount.slice(0, 500);
    }

    if (role !== undefined) {
      if (!['user', 'creator'].includes(role)) {
        return next(createError(400, 'Rol inválido (user | creator)'));
      }
      updates.role = role;
    }

    if (typeof isBanned === 'boolean') {
      updates.isBanned = isBanned;
      if (isBanned) {
        updates.tokenVersion = (user.tokenVersion || 1) + 1;
      }
    }

    if (bannedUntil !== undefined) {
      if (bannedUntil === null || bannedUntil === '') {
        updates.bannedUntil = null;
      } else {
        const d = new Date(bannedUntil);
        if (Number.isNaN(d.getTime())) {
          return next(createError(400, 'bannedUntil inválido'));
        }
        updates.bannedUntil = d;
      }
    }

    if (typeof banReason === 'string') {
      updates.banReason = banReason.slice(0, 500);
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ message: 'Nada que actualizar' });
    }

    const updated = await User.findByIdAndUpdate(id, { $set: updates }, { new: true }).select(
      '-password -passwordResetTokenHash -passwordResetExpires'
    );

    res.status(200).json(stripUser(updated));
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/panel/videos/:videoId/comments — comentarios con datos de autor.
 */
export const listPanelVideoComments = async (req, res, next) => {
  try {
    const { videoId } = req.params;
    const video = await Video.findById(videoId).select('_id').lean();
    if (!video) {
      return res.status(404).json({ message: 'Video no encontrado' });
    }

    const comments = await Comment.find({ videoId: String(videoId) }).sort({ createdAt: -1 }).lean();

    const userIds = [...new Set(comments.map((c) => c.userId).filter(Boolean))];
    const users = await User.find({ _id: { $in: userIds } })
      .select('name slug img')
      .lean();
    const map = new Map(users.map((u) => [String(u._id), u]));

    const enriched = comments.map((c) => ({
      ...c,
      author: map.get(String(c.userId)) || { _id: c.userId, name: 'Usuario', slug: '' },
    }));

    res.status(200).json({ comments: enriched });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/panel/videos/:videoId/comments — añadir comentario (moderación / soporte).
 * Requiere descriptionC y opcionalmente userId (debe existir); si no, usa TELEPRT_PANEL_COMMENT_USER_ID.
 */
export const addPanelVideoComment = async (req, res, next) => {
  try {
    const { videoId } = req.params;
    const { descriptionC, userId: bodyUserId } = req.body;

    if (!descriptionC || !String(descriptionC).trim()) {
      return next(createError(400, 'descriptionC es obligatorio'));
    }

    const video = await Video.findById(videoId).select('_id').lean();
    if (!video) {
      return next(createError(404, 'Video no encontrado'));
    }

    let userId = bodyUserId || process.env.TELEPRT_PANEL_COMMENT_USER_ID;
    if (!userId) {
      return next(
        createError(
          400,
          'Indique userId en el cuerpo o configure TELEPRT_PANEL_COMMENT_USER_ID (ObjectId de usuario existente).'
        )
      );
    }

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return next(createError(400, 'userId inválido'));
    }

    const author = await User.findOne({ _id: userId, isDeleted: { $ne: true } }).select('_id').lean();
    if (!author) {
      return next(createError(404, 'Usuario autor no encontrado'));
    }

    const comment = new Comment({
      userId: String(userId),
      videoId: String(videoId),
      descriptionC: String(descriptionC).trim().slice(0, 2000),
    });
    const saved = await comment.save();
    res.status(201).json(saved);
  } catch (err) {
    next(err);
  }
};

/**
 * DELETE /api/panel/comments/:id — eliminar cualquier comentario (moderación).
 */
export const deletePanelComment = async (req, res, next) => {
  try {
    const { id } = req.params;
    const c = await Comment.findById(id);
    if (!c) {
      return next(createError(404, 'Comentario no encontrado'));
    }
    await Comment.findByIdAndDelete(id);
    res.status(200).json({ message: 'Comentario eliminado', id });
  } catch (err) {
    next(err);
  }
};

const PANEL_VIDEO_PATCH_KEYS = new Set([
  'title',
  'description',
  'tags',
  'imgUrl',
  'classification',
  'visibility',
  'status',
]);

/**
 * PATCH /api/panel/videos/:id — actualización administrativa de metadatos y visibilidad.
 */
export const patchPanelVideo = async (req, res, next) => {
  try {
    const { id } = req.params;
    const video = await Video.findById(id);
    if (!video) {
      return next(createError(404, 'Video no encontrado'));
    }

    const updates = {};
    for (const key of PANEL_VIDEO_PATCH_KEYS) {
      if (req.body[key] !== undefined) {
        updates[key] = req.body[key];
      }
    }

    if (updates.visibility !== undefined) {
      if (!['public', 'unlisted', 'hidden'].includes(updates.visibility)) {
        return next(createError(400, 'visibility debe ser public | unlisted | hidden'));
      }
    }

    if (updates.tags !== undefined) {
      if (!Array.isArray(updates.tags)) {
        return next(createError(400, 'tags debe ser un array'));
      }
      updates.tags = updates.tags.slice(0, 20).map((t) => String(t).trim().slice(0, 50));
    }

    if (updates.title !== undefined) {
      updates.title = String(updates.title).trim().slice(0, 200);
      if (!updates.title || !/[a-zA-Z0-9]/.test(updates.title)) {
        return next(createError(400, 'Título inválido'));
      }
    }

    if (updates.description !== undefined) {
      updates.description = String(updates.description).trim().slice(0, 5000);
    }

    if (updates.classification !== undefined && !['A', 'B', 'C', 'D'].includes(updates.classification)) {
      return next(createError(400, 'classification inválida'));
    }

    if (updates.status !== undefined) {
      if (!['pending', 'processing', 'ready', 'error'].includes(updates.status)) {
        return next(createError(400, 'status inválido'));
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ message: 'Nada que actualizar' });
    }

    const updated = await Video.findByIdAndUpdate(id, { $set: updates }, { new: true });
    res.status(200).json(updated);
  } catch (err) {
    next(err);
  }
};

/**
 * DELETE /api/panel/videos/:id — eliminación administrativa permanente del documento de video.
 */
export const deletePanelVideo = async (req, res, next) => {
  try {
    const { id } = req.params;
    const video = await Video.findById(id);
    if (!video) {
      return next(createError(404, 'Video no encontrado'));
    }
    await Video.findByIdAndDelete(id);
    res.status(200).json({ message: 'Video eliminado', id });
  } catch (err) {
    next(err);
  }
};

/**
 * PATCH /api/panel/comments/:id — edición de texto y estado de moderación.
 */
export const patchPanelComment = async (req, res, next) => {
  try {
    const { id } = req.params;
    const comment = await Comment.findById(id);
    if (!comment) {
      return next(createError(404, 'Comentario no encontrado'));
    }

    const { descriptionC, moderationStatus } = req.body;
    const updates = {};

    if (typeof descriptionC === 'string' && descriptionC.trim()) {
      updates.descriptionC = descriptionC.trim().slice(0, 2000);
    }

    if (moderationStatus !== undefined) {
      if (!['approved', 'pending', 'hidden'].includes(moderationStatus)) {
        return next(createError(400, 'moderationStatus debe ser approved | pending | hidden'));
      }
      updates.moderationStatus = moderationStatus;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ message: 'Nada que actualizar' });
    }

    const updated = await Comment.findByIdAndUpdate(id, { $set: updates }, { new: true });
    res.status(200).json(updated);
  } catch (err) {
    next(err);
  }
};

/**
 * DELETE /api/panel/users/:id — baja lógica (misma semántica que el usuario borrando su cuenta).
 */
export const deletePanelUser = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return next(createError(400, 'ID de usuario inválido'));
    }

    const user = await User.findById(id).select('+tokenVersion');
    if (!user || user.isDeleted) {
      return next(createError(404, 'Usuario no encontrado'));
    }

    await User.findByIdAndUpdate(id, {
      $set: {
        isDeleted: true,
        deletedAt: new Date(),
        tokenVersion: (user.tokenVersion || 1) + 1,
        email: `deleted_${Date.now()}_${id}@deleted.teleprt.com`,
        password: 'DELETED',
        passwordResetTokenHash: null,
        passwordResetExpires: null,
      },
    });

    res.status(200).json({ message: 'Usuario eliminado', id });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/panel/stats — métricas agregadas de plataforma para el dashboard del panel.
 */
export const getPanelStats = async (req, res, next) => {
  try {
    const now = new Date();
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const sixMonthsAgo = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      totalUsers,
      totalVideos,
      bannedUsers,
      activeUsers,
      newUsersThisMonth,
      newVideosThisMonth,
      videosByStatus,
      totalViewsResult,
      topVideos,
      topUsers,
      videosByMonth,
      usersByMonth,
      pendingComments,
    ] = await Promise.all([
      User.countDocuments({ isDeleted: { $ne: true } }),
      Video.countDocuments({}),
      User.countDocuments({ isDeleted: { $ne: true }, isBanned: true }),
      User.countDocuments({ isDeleted: { $ne: true }, updatedAt: { $gte: thirtyDaysAgo } }),
      User.countDocuments({ isDeleted: { $ne: true }, createdAt: { $gte: startOfMonth } }),
      Video.countDocuments({ createdAt: { $gte: startOfMonth } }),
      Video.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
      Video.aggregate([{ $group: { _id: null, total: { $sum: '$views' } } }]),
      Video.find({}).sort({ views: -1 }).limit(5).select('title views status visibility').lean(),
      User.find({ isDeleted: { $ne: true } })
        .sort({ totalViews: -1 })
        .limit(6)
        .select('name slug img imgBanner follows totalViews')
        .lean(),
      Video.aggregate([
        { $match: { createdAt: { $gte: sixMonthsAgo } } },
        { $group: { _id: { y: { $year: '$createdAt' }, m: { $month: '$createdAt' } }, count: { $sum: 1 } } },
      ]),
      User.aggregate([
        { $match: { isDeleted: { $ne: true }, createdAt: { $gte: sixMonthsAgo } } },
        { $group: { _id: { y: { $year: '$createdAt' }, m: { $month: '$createdAt' } }, count: { $sum: 1 } } },
      ]),
      Comment.countDocuments({ moderationStatus: { $in: ['pending', 'hidden'] } }),
    ]);

    const statusMap = Object.fromEntries(videosByStatus.map((s) => [s._id || 'unknown', s.count]));
    const vMonthMap = new Map(
      videosByMonth.map(({ _id, count }) => [`${_id.y}-${String(_id.m).padStart(2, '0')}`, count]),
    );
    const uMonthMap = new Map(
      usersByMonth.map(({ _id, count }) => [`${_id.y}-${String(_id.m).padStart(2, '0')}`, count]),
    );

    const chartData = lastMonthsKeys(6).map((k) => {
      const [, m] = k.split('-');
      return {
        name: MONTH_NAMES[parseInt(m, 10) - 1] || k,
        videos: vMonthMap.get(k) || 0,
        users: uMonthMap.get(k) || 0,
      };
    });

    const lastMonth = chartData[chartData.length - 1];
    const prevMonth = chartData[chartData.length - 2];

    res.status(200).json({
      totalVideos,
      totalUsers,
      activeUsers,
      activeUsersPercent: totalUsers > 0 ? Math.round((activeUsers / totalUsers) * 100) : 0,
      bannedUsers,
      newUsersThisMonth,
      newVideosThisMonth,
      totalViews: totalViewsResult[0]?.total || 0,
      pendingComments,
      videosByStatus: statusMap,
      videosReady: statusMap.ready || 0,
      videosProcessing: (statusMap.processing || 0) + (statusMap.pending || 0),
      videosError: statusMap.error || 0,
      revenue: 0,
      chartData,
      trends: {
        users: prevMonth ? monthOverMonthTrend(lastMonth?.users || 0, prevMonth.users) : null,
        videos: prevMonth ? monthOverMonthTrend(lastMonth?.videos || 0, prevMonth.videos) : null,
      },
      topVideos: topVideos.map((v) => ({
        title: (v.title || 'Video').slice(0, 40),
        views: v.views || 0,
      })),
      topUsers,
      source: 'panel',
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/panel/videos — listado administrativo paginado (incluye ocultos y todos los estados).
 */
export const listPanelVideos = async (req, res, next) => {
  try {
    const q = req.query.q != null ? String(req.query.q).trim() : '';
    const status = req.query.status || 'all';
    const visibility = req.query.visibility || 'all';
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const skip = (page - 1) * limit;

    const filter = {};
    if (q) {
      filter.$or = [
        { title: { $regex: new RegExp(escapeRegex(q), 'i') } },
        { tags: { $regex: new RegExp(escapeRegex(q), 'i') } },
      ];
    }
    if (status !== 'all') filter.status = status;
    if (visibility !== 'all') filter.visibility = visibility;

    const [items, total] = await Promise.all([
      Video.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Video.countDocuments(filter),
    ]);

    res.status(200).json({ videos: items, total, page, limit, pages: Math.ceil(total / limit) });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/panel/videos/:id — detalle administrativo de un video.
 */
export const getPanelVideo = async (req, res, next) => {
  try {
    const video = await Video.findById(req.params.id).lean();
    if (!video) {
      return res.status(404).json({ message: 'Video no encontrado' });
    }
    res.status(200).json(video);
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/panel/infrastructure — salud de API, Mongo, Redis, cola de transcode y vistas pendientes.
 */
export const getPanelInfrastructure = async (req, res, next) => {
  try {
    const [queueStats, viewsPending, redisPing] = await Promise.all([
      getQueueStats().catch((e) => ({ error: e.message })),
      getPendingViewsSummary(),
      (async () => {
        try {
          const r = createRedisConnection();
          const pong = await r.ping();
          await r.quit();
          return { ok: pong === 'PONG' };
        } catch (e) {
          return { ok: false, error: e.message };
        }
      })(),
    ]);

    res.status(200).json({
      api: {
        nodeVersion: process.version,
        uptimeSeconds: Math.floor(process.uptime()),
        env: process.env.NODE_ENV || 'development',
      },
      mongodb: {
        state: MONGO_STATES[mongoose.connection.readyState] || 'unknown',
        host: mongoose.connection.host || null,
        name: mongoose.connection.name || null,
      },
      redis: redisPing,
      transcodeQueue: queueStats,
      viewCounter: {
        ...viewsPending,
        flushIntervalMs: parseInt(process.env.VIEW_FLUSH_INTERVAL_MS, 10) || 30000,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/panel/views/flush — fuerza flush de vistas pendientes en Redis → Mongo.
 */
export const panelFlushViews = async (req, res, next) => {
  try {
    await flushViews();
    const afterFlush = await getPendingViewsSummary();
    res.status(200).json({ success: true, afterFlush });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/panel/transcode/retry/:videoId — reintento administrativo de transcodificación.
 */
export const panelRetryTranscode = async (req, res, next) => {
  try {
    const { videoId } = req.params;
    const video = await Video.findById(videoId);

    if (!video) return next(createError(404, 'Video no encontrado'));
    if (video.status !== 'error') {
      return next(createError(400, `No se puede reintentar un video con status: ${video.status}`));
    }
    if (!video.rawKey) {
      return next(createError(400, 'El archivo original ya fue eliminado. No se puede reintentar.'));
    }

    await Video.findByIdAndUpdate(videoId, {
      status: 'pending',
      transcodeError: null,
      transcodeJobId: null,
    });

    const job = await enqueueTranscodeJob({
      videoId,
      rawKey: video.rawKey,
      userId: String(video.userId),
      title: video.title,
    });

    await Video.findByIdAndUpdate(videoId, { transcodeJobId: job.id });

    res.status(200).json({
      success: true,
      data: {
        videoId,
        jobId: job.id,
        status: 'pending',
        message: 'Transcodificación re-encolada por panel',
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/panel/comments — cola global de comentarios para moderación.
 */
export const listPanelCommentsModeration = async (req, res, next) => {
  try {
    const status = req.query.status || 'pending';
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));

    const filter =
      status === 'all'
        ? { moderationStatus: { $in: ['pending', 'hidden'] } }
        : { moderationStatus: status };

    const comments = await Comment.find(filter).sort({ createdAt: -1 }).limit(limit).lean();

    const userIds = [...new Set(comments.map((c) => c.userId).filter(Boolean))];
    const videoIds = [...new Set(comments.map((c) => c.videoId).filter(Boolean))];

    const [users, videos] = await Promise.all([
      User.find({ _id: { $in: userIds } }).select('name slug img').lean(),
      Video.find({ _id: { $in: videoIds } }).select('title visibility status').lean(),
    ]);

    const userMap = new Map(users.map((u) => [String(u._id), u]));
    const videoMap = new Map(videos.map((v) => [String(v._id), v]));

    const enriched = comments.map((c) => ({
      ...c,
      author: userMap.get(String(c.userId)) || { _id: c.userId, name: 'Usuario', slug: '' },
      video: videoMap.get(String(c.videoId)) || { _id: c.videoId, title: '(video eliminado)' },
    }));

    res.status(200).json({ comments: enriched, total: enriched.length });
  } catch (err) {
    next(err);
  }
};
