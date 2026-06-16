/**
 * Valida que los endpoints OG del servidor no incluyan la marca legacy "stream-in".
 *
 * Uso:
 *   node scripts/validate-seo-brand.js
 *   node scripts/validate-seo-brand.js https://api.teleprt.com
 */
import {
  BRAND_NAME,
  SEO_DEFAULT_TITLE,
  assertNoLegacyBrand,
} from '../config/seoBrand.js'

const API_BASE = process.argv[2] || `http://localhost:${process.env.PORT || 5000}`

async function fetchHtml(path) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Accept: 'text/html', 'User-Agent': 'teleprt-seo-validator/1.0' },
  })
  return { status: res.status, html: await res.text() }
}

async function main() {
  console.log(`Validating OG brand "${BRAND_NAME}" against ${API_BASE}\n`)

  const checks = [
    { label: 'fallback /api/og/video/invalid-id', path: '/api/og/video/000000000000000000000000' },
    { label: 'fallback /api/og/profile/invalid-slug', path: '/api/og/profile/__seo_validation__' },
  ]

  let failed = false

  for (const { label, path } of checks) {
    try {
      const { status, html } = await fetchHtml(path)
      assertNoLegacyBrand(html)

      if (!html.includes(BRAND_NAME)) {
        throw new Error(`missing brand "${BRAND_NAME}"`)
      }
      if (!html.includes(SEO_DEFAULT_TITLE.split('—')[0].trim())) {
        throw new Error('missing default SEO title fragment')
      }

      console.log(`✓ ${label} (HTTP ${status})`)
    } catch (err) {
      failed = true
      console.error(`✗ ${label}: ${err.message}`)
    }
  }

  if (failed) {
    console.error('\nSEO brand validation failed.')
    process.exit(1)
  }

  console.log('\nAll OG endpoints use the teleprt brand.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
