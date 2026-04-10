import jwt from 'jsonwebtoken'
import { createError } from './err.js'
import User from './models/User.js'

const JWT = process.env.JWT || 'token.01010101'

export const verifyToken = async (req, res, next) => {
    const token = req.cookies.access_token
    if(!token) return next(createError(401, 'You are not authenticated!'))

    jwt.verify(token, JWT, async (err, user) => {
        if(err) return next(createError(403, 'Error authenticated!'))
        
        // Verificar si el usuario existe y no está eliminado
        // Usar lean() para mejor rendimiento ya que solo necesitamos el flag
        const userDoc = await User.findById(user.id).select('isDeleted deletedAt').lean()
        
        if (!userDoc) {
            // Usuario no encontrado (fue hard deleted o no existe)
            return next(createError(401, 'You are not authenticated!'))
        }
        
        if (userDoc.isDeleted) {
            // Usuario eliminado - limpiar cookie y rechazar
            return next(createError(401, 'Account has been deleted'))
        }
        
        req.user = user
        next()
    })
}
