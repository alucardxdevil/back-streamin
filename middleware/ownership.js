/**
 * Middleware de Autorización de Propietario — stream-in
 * 
 * Capa de protección: AUTORIZACIÓN (Capa 7)
 * Amenaza cubierta: Broken Access Control - usuarios modificando datos de otros usuarios
 * 
 * Este middleware verifica que el usuario autenticado sea el propietario del recurso
 * que intenta acceder/modificar. Se aplica a rutas que reciben userId como parámetro.
 */

import { createError } from "../err.js";

/**
 * Middleware genérico para verificar propiedad de recursos.
 * 
 * @param {string} resourceKey - Nombre del parámetro de URL que contiene el ID del recurso (default: 'userId')
 * @param {string} userIdField - Campo en el documento a verificar (default: 'userId')
 * @param {Function} getResourceFn - Función opcional para obtener el recurso y verificar propiedad
 */
export const requireOwnership = (resourceKey = 'userId', userIdField = 'userId', getResourceFn = null) => {
    return (req, res, next) => {
        const authenticatedUserId = req.user?.id;
        const requestedUserId = req.params[resourceKey];

        if (!authenticatedUserId) {
            return next(createError(401, 'No autenticado'));
        }

        if (!requestedUserId) {
            return next(createError(400, `Parámetro ${resourceKey} no proporcionado`));
        }

        // Verificar que el usuario autenticado es el mismo que el recurso solicitado
        if (authenticatedUserId !== requestedUserId) {
            return next(createError(403, 'No tienes permiso para acceder a este recurso'));
        }

        next();
    };
};

/**
 * Middleware específico para verificar propiedad de playlist.
 * Verifica que la playlist pertenezca al usuario.
 */
export const requirePlaylistOwnership = async (req, res, next) => {
    const authenticatedUserId = req.user?.id;
    const { userId, playlistId } = req.params;

    if (!authenticatedUserId) {
        return next(createError(401, 'No autenticado'));
    }

    if (!userId || !playlistId) {
        return next(createError(400, 'Parámetros userId o playlistId no proporcionados'));
    }

    // Verificar que el usuario autenticado es el mismo que el propietario de la playlist
    if (authenticatedUserId !== userId) {
        return next(createError(403, 'No tienes permiso para acceder a esta playlist'));
    }

    next();
};

/**
 * Middleware para verificar que el usuario puede modificar un video.
 * Solo el propietario del video puede editarlo/eliminarlo.
 */
export const requireVideoOwnership = (Model) => {
    return async (req, res, next) => {
        const authenticatedUserId = req.user?.id;
        const videoId = req.params.id;

        if (!authenticatedUserId) {
            return next(createError(401, 'No autenticado'));
        }

        if (!videoId) {
            return next(createError(400, 'ID de video no proporcionado'));
        }

        try {
            const video = await Model.findById(videoId);
            
            if (!video) {
                return next(createError(404, 'Video no encontrado'));
            }

            // Comparar como strings para evitar problemas de tipo
            if (video.userId?.toString() !== authenticatedUserId) {
                return next(createError(403, 'No tienes permiso para modificar este video'));
            }

            next();
        } catch (err) {
            next(err);
        }
    };
};

/**
 * Middleware para verificar que el usuario puede modificar un usuario.
 * Un usuario solo puede modificar su propio perfil.
 */
export const requireUserOwnership = (paramKey = 'id') => {
    return (req, res, next) => {
        const authenticatedUserId = req.user?.id;
        const targetUserId = req.params[paramKey];

        if (!authenticatedUserId) {
            return next(createError(401, 'No autenticado'));
        }

        if (!targetUserId) {
            return next(createError(400, 'ID de usuario no proporcionado'));
        }

        if (authenticatedUserId !== targetUserId) {
            return next(createError(403, 'No tienes permiso para modificar este perfil'));
        }

        next();
    };
};

export default {
    requireOwnership,
    requirePlaylistOwnership,
    requireVideoOwnership,
    requireUserOwnership,
};
