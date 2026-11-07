// What each network accepts when this app creates a post. The API is the final
// judge, but its refusals are generic, so the limits we know are checked here
// first and turned into a sentence that says what to do.
//
// `supported: false` means this version cannot create a valid post for the
// network at all: it sends text plus an optional image, not video or boards.
const LIMITS = {
  twitter: { label: 'X', max: 280 },
  x: { label: 'X', max: 280 },
  bluesky: { label: 'Bluesky', max: 300 },
  threads: { label: 'Threads', max: 500 },
  mastodon: { label: 'Mastodon', max: 500, note: 'Some servers allow fewer characters.' },
  linkedin: { label: 'LinkedIn', max: 3000 },
  instagram: { label: 'Instagram', max: 2200, needsImage: true },
  facebook: { label: 'Facebook', max: 63206 },
  googlebusiness: { label: 'Google Business', max: 1500 },
  'google-business': { label: 'Google Business', max: 1500 },
  google_business: { label: 'Google Business', max: 1500 },
  pinterest: {
    label: 'Pinterest',
    max: 500,
    supported: false,
    note: 'Pinterest needs a board and an image. This version cannot create Pins.',
  },
  tiktok: {
    label: 'TikTok',
    max: 2200,
    supported: false,
    note: 'TikTok needs a video. This version sends text and images.',
  },
  youtube: {
    label: 'YouTube',
    max: 5000,
    supported: false,
    note: 'YouTube posts need a video. This version sends text and images.',
  },
  substack: { label: 'Substack', max: 4000 },
}

const FALLBACK = { label: 'This channel', max: 4000 }

function humanize(service) {
  if (!service) return FALLBACK.label
  return service.charAt(0).toUpperCase() + service.slice(1).replace(/[_-]/g, ' ')
}

export function postLimit(service) {
  const found = LIMITS[String(service || '').toLowerCase()]
  if (found) {
    return {
      label: found.label,
      max: found.max,
      needsImage: Boolean(found.needsImage),
      supported: found.supported !== false,
      note: found.note || null,
    }
  }
  return {
    label: humanize(service),
    max: FALLBACK.max,
    needsImage: false,
    supported: true,
    note: null,
  }
}

// Returns a sentence to show the user, or null when the post can be attempted.
export function checkPost({ service, text, imageUrl }) {
  const limit = postLimit(service)

  if (!limit.supported) {
    return `${limit.note} Pick another channel.`
  }
  if (limit.needsImage && !imageUrl) {
    return `${limit.label} needs an image. Add an image link.`
  }
  if (text.length > limit.max) {
    return `${limit.label} allows ${limit.max.toLocaleString('en-US')} characters. This draft is ${text.length.toLocaleString('en-US')}. Shorten it to send.`
  }
  return null
}
