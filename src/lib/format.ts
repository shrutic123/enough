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

export function formatCardSubline(channelName: string, dueAt: string | null): string {
  return `${channelName} · ${formatDueAt(dueAt)}`
}

export function formatLeft(count: number): string {
  return `${count} left`
}

export function formatTotals(kept: number, cut: number): string {
  return `${kept} kept. ${cut} cut.`
}
