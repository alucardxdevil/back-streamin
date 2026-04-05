import express from 'express';
import Video from '../models/Video.js';
import User from '../models/User.js';

const router = express.Router();

const SITE_URL = process.env.SITE_URL || 'https://stream-in.com';
const SITE_NAME = 'stream-in';

/**
 * Escapa caracteres HTML para prevenir XSS en las meta tags.
 */
function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/'/g, '&#39;');
}

/**
 * GET /api/og/video/:id
 *
 * Devuelve un HTML mínimo con meta tags OG/Twitter para un video específico.
 * Este endpoint es consumido por el Cloudflare Worker cuando detecta un crawler.
 */
router.get('/video/:id', async (req, res) => {
  try {
    const video = await Video.findById(req.params.id)
      .select('title description imgUrl hlsMasterUrl videoUrl views duration tags createdAt userId')
      .lean();

    if (!video) {
      return res.status(404).send(buildFallbackHtml());
    }

    // Obtener datos del creador
    let channel = null;
    try {
      channel = await User.findById(video.userId)
        .select('name slug img')
        .lean();
    } catch { /* ignorar */ }

    const title = escapeHtml(video.title || 'Video');
    const description = escapeHtml(
      (video.description || `Watch "${video.title}" on ${SITE_NAME}`)
        .substring(0, 200)
    );
    const thumbnail = escapeHtml(video.imgUrl || `${SITE_URL}/logo-pest.jpg`);
    const pageUrl = `${SITE_URL}/video/${video._id}`;
    const embedUrl = escapeHtml(video.hlsMasterUrl || video.videoUrl || '');
    const channelName = escapeHtml(channel?.name || 'Creator');
    const channelUrl = channel?.slug
      ? `${SITE_URL}/profileUser/${escapeHtml(channel.slug)}`
      : `${SITE_URL}`;
    const uploadDate = video.createdAt
      ? new Date(video.createdAt).toISOString()
      : new Date().toISOString();

    // Duración ISO 8601
    const durationISO = video.duration
      ? `PT${Math.floor(video.duration / 60)}M${Math.floor(video.duration % 60)}S`
      : undefined;

    // JSON-LD VideoObject
    const jsonLd = {
      '@context': 'https://schema.org',
      '@type': 'VideoObject',
      name: video.title || 'Video',
      description: video.description || `Watch "${video.title}" on ${SITE_NAME}`,
      thumbnailUrl: [video.imgUrl || `${SITE_URL}/logo-pest.jpg`],
      uploadDate,
      contentUrl: video.hlsMasterUrl || video.videoUrl || '',
      embedUrl: video.hlsMasterUrl || video.videoUrl || '',
      url: pageUrl,
      interactionStatistic: {
        '@type': 'InteractionCounter',
        interactionType: { '@type': 'WatchAction' },
        userInteractionCount: video.views || 0,
      },
      author: {
        '@type': 'Person',
        name: channel?.name || 'Creator',
        url: channelUrl,
      },
      publisher: {
        '@type': 'Organization',
        name: SITE_NAME,
        logo: { '@type': 'ImageObject', url: `${SITE_URL}/logo-pest.jpg` },
      },
      ...(durationISO && { duration: durationISO }),
      ...(video.tags?.length && { keywords: video.tags.join(', ') }),
    };

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${title} | ${SITE_NAME}</title>
  <meta name="description" content="${description}" />
  <link rel="canonical" href="${pageUrl}" />

  <!-- Open Graph -->
  <meta property="og:site_name" content="${SITE_NAME}" />
  <meta property="og:type" content="video.other" />
  <meta property="og:title" content="${title} | ${SITE_NAME}" />
  <meta property="og:description" content="${description}" />
  <meta property="og:image" content="${thumbnail}" />
  <meta property="og:image:width" content="1280" />
  <meta property="og:image:height" content="720" />
  <meta property="og:url" content="${pageUrl}" />
  <meta property="og:locale" content="en_US" />
  ${embedUrl ? `<meta property="og:video" content="${embedUrl}" />` : ''}
  ${embedUrl ? '<meta property="og:video:type" content="application/x-mpegURL" />' : ''}
  <meta property="article:author" content="${channelName}" />

  <!-- Twitter Cards -->
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${title} | ${SITE_NAME}" />
  <meta name="twitter:description" content="${description}" />
  <meta name="twitter:image" content="${thumbnail}" />
  <meta name="twitter:image:alt" content="${title}" />

  <!-- JSON-LD -->
  <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>

  <!-- Redirect real users to the SPA -->
  <meta http-equiv="refresh" content="0;url=${pageUrl}" />
</head>
<body>
  <h1>${title}</h1>
  <p>${description}</p>
  <p>By ${channelName}</p>
  <img src="${thumbnail}" alt="${title}" />
  <a href="${pageUrl}">Watch on ${SITE_NAME}</a>
</body>
</html>`;

    res.set('Content-Type', 'text/html; charset=utf-8');
    res.set('Cache-Control', 'public, max-age=3600, s-maxage=86400');
    res.status(200).send(html);
  } catch (err) {
    console.error('Error en /api/og/video:', err);
    res.status(500).send(buildFallbackHtml());
  }
});

/**
 * GET /api/og/profile/:slug
 *
 * Devuelve un HTML mínimo con meta tags OG/Twitter para un perfil de usuario.
 */
router.get('/profile/:slug', async (req, res) => {
  try {
    // Buscar por slug primero, luego por _id
    let user = await User.findOne({ slug: req.params.slug })
      .select('name slug img imgBanner descriptionAccount follows')
      .lean();

    if (!user) {
      user = await User.findById(req.params.slug)
        .select('name slug img imgBanner descriptionAccount follows')
        .lean();
    }

    if (!user) {
      return res.status(404).send(buildFallbackHtml());
    }

    const name = escapeHtml(user.name || 'User');
    const description = escapeHtml(
      (user.descriptionAccount || `Profile of ${user.name} on ${SITE_NAME}. ${user.follows || 0} followers.`)
        .substring(0, 200)
    );
    const profileImage = escapeHtml(user.img || `${SITE_URL}/logo-pest.jpg`);
    const profileUrl = `${SITE_URL}/profileUser/${escapeHtml(user.slug || user._id)}`;

    // JSON-LD Person
    const jsonLd = {
      '@context': 'https://schema.org',
      '@type': 'Person',
      name: user.name || 'User',
      url: profileUrl,
      image: user.img || `${SITE_URL}/logo-pest.jpg`,
      description: user.descriptionAccount || `Content creator on ${SITE_NAME}`,
      ...(user.follows && {
        interactionStatistic: {
          '@type': 'InteractionCounter',
          interactionType: { '@type': 'FollowAction' },
          userInteractionCount: user.follows,
        },
      }),
    };

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${name} | ${SITE_NAME}</title>
  <meta name="description" content="${description}" />
  <link rel="canonical" href="${profileUrl}" />

  <!-- Open Graph -->
  <meta property="og:site_name" content="${SITE_NAME}" />
  <meta property="og:type" content="profile" />
  <meta property="og:title" content="${name} | ${SITE_NAME}" />
  <meta property="og:description" content="${description}" />
  <meta property="og:image" content="${profileImage}" />
  <meta property="og:url" content="${profileUrl}" />
  <meta property="og:locale" content="en_US" />
  <meta property="profile:username" content="${escapeHtml(user.slug || user.name)}" />

  <!-- Twitter Cards -->
  <meta name="twitter:card" content="summary" />
  <meta name="twitter:title" content="${name} | ${SITE_NAME}" />
  <meta name="twitter:description" content="${description}" />
  <meta name="twitter:image" content="${profileImage}" />

  <!-- JSON-LD -->
  <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>

  <!-- Redirect real users to the SPA -->
  <meta http-equiv="refresh" content="0;url=${profileUrl}" />
</head>
<body>
  <h1>${name}</h1>
  <p>${description}</p>
  <img src="${profileImage}" alt="${name}" />
  <a href="${profileUrl}">View profile on ${SITE_NAME}</a>
</body>
</html>`;

    res.set('Content-Type', 'text/html; charset=utf-8');
    res.set('Cache-Control', 'public, max-age=3600, s-maxage=86400');
    res.status(200).send(html);
  } catch (err) {
    console.error('Error en /api/og/profile:', err);
    res.status(500).send(buildFallbackHtml());
  }
});

/**
 * HTML de fallback cuando no se encuentra el recurso.
 */
function buildFallbackHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${SITE_NAME} — Share and discover videos</title>
  <meta name="description" content="${SITE_NAME} is the platform for uploading, sharing, and discovering videos from independent creators." />
  <meta property="og:site_name" content="${SITE_NAME}" />
  <meta property="og:title" content="${SITE_NAME} — Share and discover videos" />
  <meta property="og:description" content="${SITE_NAME} is the platform for uploading, sharing, and discovering videos from independent creators." />
  <meta property="og:image" content="${SITE_URL}/logo-pest.jpg" />
  <meta property="og:url" content="${SITE_URL}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${SITE_NAME} — Share and discover videos" />
  <meta name="twitter:image" content="${SITE_URL}/logo-pest.jpg" />
  <meta http-equiv="refresh" content="0;url=${SITE_URL}" />
</head>
<body>
  <h1>${SITE_NAME}</h1>
  <p>Share and discover videos from independent creators.</p>
  <a href="${SITE_URL}">Go to ${SITE_NAME}</a>
</body>
</html>`;
}

export default router;
