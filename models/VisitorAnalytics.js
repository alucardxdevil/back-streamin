import mongoose from 'mongoose';

/** Contadores globales denormalizados (lectura rápida en panel). */
const visitorAnalyticsSchema = new mongoose.Schema(
  {
    key: { type: String, default: 'global', unique: true },
    totalUniqueVisitors: { type: Number, default: 0 },
    totalPageViews: { type: Number, default: 0 },
    lastVisitAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export default mongoose.model('VisitorAnalytics', visitorAnalyticsSchema);
