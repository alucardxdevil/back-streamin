import express from 'express';
import Video from '../models/Video.js';
import User from '../models/User.js';

const router = express.Router();

/**
 * GET /sitemap.xml
 *
 * Genera un sitemap XML dinámico que incluye:
 *  • Rutas estáticas principales (/, /trends, /us, /help, /terms, /contact)
 *  • URLs de todos los videos con status "ready"
 *  • URLs de todos los perfiles de usuario públicos
 *
 * Google y otros crawlers pueden consumir este endpoint directamente.
 * Configurar en robots.txt: Sitemap: https://stream-in.com/sitemap.xml
 */
router.get('/sitemap.xml', async (req, res) => {
  try {
    const SITE_URL = process.env.SITE_URL || 'https://stream-in.com';

    // ── Rutas estáticas ────────────────────────────────────────────────────
    const staticRoutes = [
      { loc: '/',        changefreq: 'daily',   priority: '1.0' },
      { loc: '/trends',  changefreq: 'hourly',  priority: '0.9' },
      { loc: '/us',      changefreq: 'monthly', priority: '0.5' },
      { loc: '/help',    changefreq: 'monthly', priority: '0.4' },
      { loc: '/terms',   changefreq: 'yearly',  priority: '0.3' },
      { loc: '/contact', changefreq: 'monthly', priority: '0.4' },
      { loc: '/support', changefreq: 'monthly', priority: '0.4' },
    ];

    // ── Videos (solo los que están listos para reproducción) ────────────────
    const videos = await Video.find(
      { status: 'ready' },
      { _id: 1, title: 1, description: 1, imgUrl: 1, createdAt: 1, updatedAt: 1, duration: 1 }
    )
      .sort({ createdAt: -1 })
      .limit(50000) // Límite del protocolo sitemap
      .lean();

    // ── Usuarios con al menos un video ─────────────────────────────────────
    const users = await User.find(
      {},
      { _id: 1, slug: 1, name: 1, updatedAt: 1 }
    )
      .limit(50000)
      .lean();

    // ── Construir XML ──────────────────────────────────────────────────────
    let xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">
`;

    // Rutas estáticas
    for (const route of staticRoutes) {
      xml += `  <url>
    <loc>${SITE_URL}${route.loc}</loc>
    <changefreq>${route.changefreq}</changefreq>
    <priority>${route.priority}</priority>
  </url>
`;
    }

    // Videos
    for (const video of videos) {
      const lastmod = (video.updatedAt || video.createdAt)
        ? new Date(video.updatedAt || video.createdAt).toISOString().split('T')[0]
        : '';
      const description = (video.description || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .substring(0, 2048);
      const title = (video.title || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

      xml += `  <url>
    <loc>${SITE_URL}/video/${video._id}</loc>
    ${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
    <video:video>
      <video:thumbnail_loc>${video.imgUrl || ''}</video:thumbnail_loc>
      <video:title>${title}</video:title>
      <video:description>${description}</video:description>
      ${video.duration ? `<video:duration>${Math.round(video.duration)}</video:duration>` : ''}
    </video:video>
  </url>
`;
    }

    // Perfiles de usuario
    for (const user of users) {
      const slug = user.slug || user._id;
      const lastmod = user.updatedAt
        ? new Date(user.updatedAt).toISOString().split('T')[0]
        : '';

      xml += `  <url>
    <loc>${SITE_URL}/profileUser/${slug}</loc>
    ${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}
    <changefreq>weekly</changefreq>
    <priority>0.6</priority>
  </url>
`;
    }

    xml += `</urlset>`;

    res.set('Content-Type', 'application/xml');
    res.set('Cache-Control', 'public, max-age=3600'); // Cache 1 hora
    res.status(200).send(xml);
  } catch (err) {
    console.error('Error generando sitemap:', err);
    res.status(500).send('Error generando sitemap');
  }
});

export default router;
