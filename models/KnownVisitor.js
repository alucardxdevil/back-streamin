import mongoose from 'mongoose';

/**
 * Visitante único del sitio (registrado o anónimo).
 * visitorId = UUID persistido en localStorage del navegador.
 */
const knownVisitorSchema = new mongoose.Schema(
  {
    visitorId: { type: String, required: true, unique: true, index: true },
    country: { type: String, default: 'XX', uppercase: true, maxlength: 2, index: true },
    firstPath: { type: String, default: '/' },
    lastPath: { type: String, default: '/' },
    visitCount: { type: Number, default: 1 },
    firstSeenAt: { type: Date, default: Date.now },
    lastSeenAt: { type: Date, default: Date.now, index: true },
    userAgent: { type: String, default: '', maxlength: 512 },
  },
  { timestamps: false }
);

knownVisitorSchema.index({ lastSeenAt: -1 });

export default mongoose.model('KnownVisitor', knownVisitorSchema);
