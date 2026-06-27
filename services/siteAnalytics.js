import KnownVisitor from '../models/KnownVisitor.js';
import VisitorAnalytics from '../models/VisitorAnalytics.js';
import logger from '../config/logger.js';
import { isLikelyBot, resolveVisitorCountry, resolveVisitorId } from '../utils/visitorContext.js';

const GLOBAL_KEY = 'global';
const ONLINE_WINDOW_MS = 5 * 60 * 1000;

async function ensureGlobalDoc() {
  return VisitorAnalytics.findOneAndUpdate(
    { key: GLOBAL_KEY },
    { $setOnInsert: { key: GLOBAL_KEY, totalUniqueVisitors: 0, totalPageViews: 0 } },
    { upsert: true, new: true }
  ).lean();
}

/**
 * Registra una visita al sitio (página SPA).
 * @returns {{ recorded: boolean, isNewVisitor: boolean }}
 */
export async function recordSiteVisit(req, { path = '/', visitorId: bodyVisitorId } = {}) {
  const userAgent = String(req.headers['user-agent'] || '');
  if (isLikelyBot(userAgent)) {
    return { recorded: false, isNewVisitor: false, reason: 'bot' };
  }

  const visitorId = resolveVisitorId(req, bodyVisitorId);
  const country = resolveVisitorCountry(req);
  const safePath = String(path || '/').slice(0, 512);
  const now = new Date();

  const existing = await KnownVisitor.findOne({ visitorId }).select('_id').lean();
  const isNewVisitor = !existing;

  await KnownVisitor.findOneAndUpdate(
    { visitorId },
    {
      $set: {
        lastSeenAt: now,
        lastPath: safePath,
        country,
        ...(userAgent ? { userAgent: userAgent.slice(0, 512) } : {}),
      },
      $setOnInsert: {
        visitorId,
        country,
        firstPath: safePath,
        firstSeenAt: now,
        visitCount: 0,
      },
      $inc: { visitCount: 1 },
    },
    { upsert: true, new: false }
  );

  const inc = { totalPageViews: 1, lastVisitAt: now };
  if (isNewVisitor) inc.totalUniqueVisitors = 1;

  await VisitorAnalytics.findOneAndUpdate(
    { key: GLOBAL_KEY },
    { $inc: inc, $setOnInsert: { key: GLOBAL_KEY } },
    { upsert: true }
  );

  return { recorded: true, isNewVisitor, visitorId, country };
}

export async function getVisitorAnalyticsSnapshot() {
  const fiveMinAgo = new Date(Date.now() - ONLINE_WINDOW_MS);

  const [global, countryAgg, onlineNow, last24h] = await Promise.all([
    ensureGlobalDoc(),
    KnownVisitor.aggregate([
      {
        $group: {
          _id: '$country',
          visitors: { $sum: 1 },
          pageViews: { $sum: '$visitCount' },
        },
      },
      { $sort: { visitors: -1 } },
      { $limit: 250 },
    ]),
    KnownVisitor.countDocuments({ lastSeenAt: { $gte: fiveMinAgo } }),
    KnownVisitor.countDocuments({
      lastSeenAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    }),
  ]);

  const countries = countryAgg.map((row) => ({
    country: row._id || 'XX',
    visitors: row.visitors || 0,
    pageViews: row.pageViews || 0,
  }));

  const totalFromAgg = countries.reduce((s, c) => s + c.visitors, 0);

  return {
    totalUniqueVisitors: global?.totalUniqueVisitors ?? totalFromAgg,
    totalPageViews: global?.totalPageViews ?? 0,
    onlineNow,
    visitorsLast24h: last24h,
    lastVisitAt: global?.lastVisitAt ?? null,
    countries,
    updatedAt: new Date().toISOString(),
  };
}

export async function getRealtimeVisitorPulse(limit = 20) {
  const rows = await KnownVisitor.find({})
    .sort({ lastSeenAt: -1 })
    .limit(limit)
    .select('visitorId country lastPath lastSeenAt visitCount')
    .lean();

  return rows.map((r) => ({
    country: r.country || 'XX',
    path: r.lastPath || '/',
    lastSeenAt: r.lastSeenAt,
    visitCount: r.visitCount || 1,
    visitorId: `${String(r.visitorId).slice(0, 8)}…`,
  }));
}

export function startSiteAnalyticsLogger() {
  logger.info('[siteAnalytics] Visitor tracking ready');
}
