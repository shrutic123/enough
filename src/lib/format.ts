const dueFormatter = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

export function formatDueAt(dueAt: string | null): string {
  if (!dueAt) return 'No date'

  const date = new Date(dueAt)
  if (Number.isNaN(date.getTime())) return 'No date'

  return dueFormatter.format(date)
}

const SERVICE_LABELS: Record<string, string> = {
  instagram: 'Instagram',
  linkedin: 'LinkedIn',
  facebook: 'Facebook',
  twitter: 'X',
  x: 'X',
  threads: 'Threads',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  pinterest: 'Pinterest',
  googlebusiness: 'Google Business',
  mastodon: 'Mastodon',
  bluesky: 'Bluesky',
  substack: 'Substack',
}

export function serviceLabel(service: string): string {
  return SERVICE_LABELS[service] || ''
}

export function formatCardSubline(
  service: string,
  channelName: string,
  dueAt: string | null,
): string {
  const network = serviceLabel(service)
  // The network first, then the account. A channel whose name is already the
  // network (some accounts are named "Instagram") is not repeated.
  const parts = [network, channelName].filter(
    (part, index, all) => Boolean(part) && all.indexOf(part) === index,
  )
  return [...parts, formatDueAt(dueAt)].join(' · ')
}

export function formatLeft(count: number): string {
  return `${count} left`
}

export function formatTotals(kept: number, cut: number): string {
  return `${kept} kept. ${cut} cut.`
}
