// Deterministic data for DEMO_MODE=fixture.
//
// The recorder serves these responses from Playwright's network layer, so the
// video is of the real production build but never reads or deletes anything in
// Buffer. Use live mode when the video has to prove the integration.
import { postLimit } from '../server/limits.js'

export const ORG_ID = 'demo-org'

export const DEMO_DRAFT = `We shipped the first version of this tool three years ago from a kitchen table. Today it runs in twelve newsrooms, and I still get the same feeling watching someone publish their first post. The whole story, including the parts that did not work, is here: https://example.com/notes/three-years`

export const DEMO_TRIMMED = `We shipped the first version from a kitchen table three years ago. Today it runs in twelve newsrooms. The whole story, including the parts that did not work: https://example.com/notes/three-years`

const CHANNELS = [
  {
    id: 'demo-linkedin',
    name: 'Fieldnotes',
    displayName: 'Fieldnotes',
    service: 'linkedin',
  },
  {
    id: 'demo-x',
    name: 'fieldnotes',
    displayName: '@fieldnotes',
    service: 'twitter',
  },
  {
    id: 'demo-instagram',
    name: 'fieldnotes.studio',
    displayName: 'fieldnotes.studio',
    service: 'instagram',
  },
]

function daysFromNow(days) {
  const date = new Date()
  date.setUTCHours(15, 0, 0, 0)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString()
}

function post(id, channelId, text, days, status = 'scheduled', asset = null) {
  return {
    id,
    text,
    channelId,
    channelName: CHANNELS.find((channel) => channel.id === channelId)?.displayName || '',
    service: CHANNELS.find((channel) => channel.id === channelId)?.service || '',
    dueAt: daysFromNow(days),
    status,
    asset,
  }
}

export function buildSession() {
  return {
    connected: true,
    account: {
      id: 'demo-account',
      email: 'demo@enough.local',
      name: 'Demo',
      organizations: [{ id: ORG_ID, name: 'Fieldnotes' }],
    },
  }
}

export function buildChannels() {
  return {
    channels: CHANNELS.map((channel) => ({
      ...channel,
      limit: postLimit(channel.service),
    })),
  }
}

export function buildQueue() {
  return {
    posts: [
      post(
        'demo-1',
        'demo-instagram',
        'The launch post I wrote three weeks ago and never sent.',
        -12,
        'scheduled',
        {
          thumbnail: 'https://picsum.photos/id/1025/240/240',
          source: 'https://picsum.photos/id/1025/1080/1080',
          type: 'image',
        },
      ),
      post(
        'demo-2',
        'demo-linkedin',
        'Three years ago we shipped the first version of this tool from a kitchen table. Today it runs in twelve newsrooms, and I still get the same feeling watching someone publish their first post. The whole story, including the parts that did not work: https://example.com/notes/three-years',
        3,
      ),
      post(
        'demo-3',
        'demo-x',
        'A quieter way to plan the week. No dashboards, no streaks. Just the posts you meant to write.',
        4,
      ),
      post(
        'demo-4',
        'demo-linkedin',
        'A quieter way to plan the week is here. No dashboards, no streaks. Just the posts you meant to write.',
        5,
      ),
      post('demo-5', 'demo-x', 'Reminder: the studio is closed on Friday.', 6, 'error'),
      post(
        'demo-6',
        'demo-instagram',
        'A short one: leave a little room in the queue for the thing you write on the day.',
        9,
        'scheduled',
        {
          thumbnail: 'https://picsum.photos/id/1062/240/240',
          source: 'https://picsum.photos/id/1062/1080/1080',
          type: 'image',
        },
      ),
    ],
  }
}

export function trimFixture(text) {
  return text.trim() === DEMO_DRAFT ? DEMO_TRIMMED : text
}
