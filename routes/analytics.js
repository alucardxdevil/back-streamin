import express from 'express';
import { recordSiteVisit } from '../services/siteAnalytics.js';
import { analyticsRateLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

/**
 * POST /api/analytics/visit
 * Beacon público desde teleprt.com (SPA). Sin auth; rate-limited.
 */
router.post('/visit', analyticsRateLimiter, async (req, res) => {
  try {
    const path = req.body?.path || req.body?.page || '/';
    const visitorId = req.body?.visitorId;

    const result = await recordSiteVisit(req, { path, visitorId });

    res.status(202).json({
      ok: true,
      recorded: result.recorded,
      isNewVisitor: result.isNewVisitor ?? false,
    });
  } catch (err) {
    res.status(500).json({ ok: false, message: 'Analytics unavailable' });
  }
});

export default router;
