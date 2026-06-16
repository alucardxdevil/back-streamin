/** Copy de marca teleprt para OG/HTML del servidor (crawlers). */
export const BRAND_NAME = 'teleprt'
export const BRAND_DOMAIN = 'teleprt.com'
export const TWITTER_HANDLE = '@teleprt'

export const SEO_DEFAULT_TITLE = 'teleprt — Watch, share and create videos'
export const SEO_DEFAULT_DESCRIPTION =
  'teleprt is the beta video platform to upload, share and discover content from independent creators. Explore trends at teleprt.com.'

export function videoDescription(title) {
  return `Watch "${title || 'Video'}" on ${BRAND_NAME} — videos from independent creators.`
}

export function profileDescription(name, followers = 0) {
  return `Profile of ${name || 'User'} on ${BRAND_NAME}. ${followers} followers.`
}

export function creatorBioFallback() {
  return `Content creator on ${BRAND_NAME}`
}
