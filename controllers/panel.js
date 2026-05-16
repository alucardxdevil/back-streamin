import mongoose from 'mongoose';
import slugify from 'slugify';
import { createError } from '../err.js';
import User from '../models/User.js';
import Video from '../models/Video.js';
import Comment from '../models/Comments.js';

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
    const filter = q
      ? { ...baseFilter, name: { $regex: new RegExp(escapeRegex(q), 'i') } }
      : baseFilter;

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
 * Requiere descriptionC y opcionalmente userId (debe existir); si no, usa STREAM_IN_PANEL_COMMENT_USER_ID.
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

    let userId = bodyUserId || process.env.STREAM_IN_PANEL_COMMENT_USER_ID;
    if (!userId) {
      return next(
        createError(
          400,
          'Indique userId en el cuerpo o configure STREAM_IN_PANEL_COMMENT_USER_ID (ObjectId de usuario existente).'
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
        email: `deleted_${Date.now()}_${id}@deleted.stream-in.com`,
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
