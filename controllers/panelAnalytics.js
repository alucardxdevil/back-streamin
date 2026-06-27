import { getVisitorAnalyticsSnapshot, getRealtimeVisitorPulse } from '../services/siteAnalytics.js';

/** GET /api/panel/analytics/visitors */
export async function getPanelVisitorAnalytics(req, res, next) {
  try {
    const snapshot = await getVisitorAnalyticsSnapshot();
    res.json(snapshot);
  } catch (err) {
    next(err);
  }
}

/** GET /api/panel/analytics/realtime */
export async function getPanelRealtimeAnalytics(req, res, next) {
  try {
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const [snapshot, pulse] = await Promise.all([
      getVisitorAnalyticsSnapshot(),
      getRealtimeVisitorPulse(limit),
    ]);
    res.json({
      ...snapshot,
      recentActivity: pulse,
    });
  } catch (err) {
    next(err);
  }
}
