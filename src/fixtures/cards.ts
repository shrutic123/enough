import type { QueueCard } from '../types'

export type FixtureCard = QueueCard & { reason?: string }

/** Demo-only data. Never used outside `import.meta.env.DEV` with `?demo=1`. */
export const fixtureCards: FixtureCard[] = [
  {
    id: 'fixture-1',
    text: 'Three years ago we shipped the first version of this tool from a kitchen table. Today it runs in twelve newsrooms, and I still get the same feeling watching someone publish their first post. The whole story, including the parts that did not work: https://example.com/notes/three-years',
    channelId: 'fixture-linkedin',
    channelName: 'LinkedIn',
    service: 'linkedin',
    dueAt: '2026-11-12T14:00:00.000Z',
    status: 'scheduled',
  },
  {
    id: 'fixture-2',
    text: 'A quieter way to plan the week. No dashboards, no streaks. Just the posts you meant to write.',
    channelId: 'fixture-x',
    channelName: 'X',
    service: 'twitter',
    dueAt: '2026-11-13T17:15:00.000Z',
    status: 'scheduled',
    reason: 'Nearly the same as another post.',
  },
  {
    id: 'fixture-3',
    text: 'A quieter way to plan the week is here. No dashboards, no streaks. Just the posts you meant to write.',
    channelId: 'fixture-linkedin',
    channelName: 'LinkedIn',
    service: 'linkedin',
    dueAt: '2026-11-14T14:30:00.000Z',
    status: 'scheduled',
    reason: 'Nearly the same as another post.',
  },
  {
    id: 'fixture-4',
    text: 'The launch post I wrote three weeks ago and never sent.',
    channelId: 'fixture-instagram',
    channelName: 'Instagram',
    service: 'instagram',
    dueAt: '2026-10-28T18:00:00.000Z',
    status: 'scheduled',
    reason: 'This was meant to go out already.',
  },
  {
    id: 'fixture-5',
    text: 'Reminder: the studio is closed on Friday.',
    channelId: 'fixture-x',
    channelName: 'X',
    service: 'twitter',
    dueAt: '2026-11-15T12:00:00.000Z',
    status: 'error',
    reason: "This one didn't send.",
  },
  {
    id: 'fixture-6',
    text: 'A short one: leave a little room in the queue for the thing you write on the day.',
    channelId: 'fixture-instagram',
    channelName: 'Instagram',
    service: 'instagram',
    dueAt: '2026-11-18T15:45:00.000Z',
    status: 'scheduled',
  },
]
