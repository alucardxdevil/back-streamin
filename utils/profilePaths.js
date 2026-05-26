/**
 * Rutas públicas de perfil — formato universal /@slug
 */

export function normalizeProfileSlug(slugOrAtSlug) {
  if (slugOrAtSlug == null || slugOrAtSlug === '') return '';
  return String(slugOrAtSlug).replace(/^@+/, '').trim();
}

export function getProfileSlug(user) {
  if (!user) return '';
  return user.slug || String(user._id || '');
}

export function getPublicProfilePath(userOrSlug, { absolute = false, siteUrl = '' } = {}) {
  const slug =
    typeof userOrSlug === 'string'
      ? normalizeProfileSlug(userOrSlug)
      : normalizeProfileSlug(getProfileSlug(userOrSlug));

  if (!slug) {
    return absolute && siteUrl ? siteUrl.replace(/\/$/, '') : '/';
  }

  const path = `/@${slug}`;
  return absolute && siteUrl ? `${siteUrl.replace(/\/$/, '')}${path}` : path;
}
