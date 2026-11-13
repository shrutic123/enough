import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEMO_DRAFT,
  DEMO_TRIMMED,
  buildChannels,
  buildQueue,
  buildSession,
  trimFixture,
} from '../demo/fixtures.mjs'

test('fixture session is connected and has one organization', () => {
  const session = buildSession()
  assert.equal(session.connected, true)
  assert.equal(session.account.organizations.length, 1)
  assert.ok(session.account.organizations[0].id)
})

test('fixture queue is ordered enough for the storyboard', () => {
  const { posts } = buildQueue()
  assert.equal(posts.length, 6)
  assert.ok(posts.every((post) => post.id && post.text && post.channelId))
  assert.ok(new Date(posts[0].dueAt).getTime() < Date.now(), 'first card is overdue')
  assert.ok(new Date(posts.at(-1).dueAt).getTime() > Date.now(), 'last card is future')
})

test('fixture channels have limits and put LinkedIn first', () => {
  const { channels } = buildChannels()
  assert.equal(channels.length, 3)
  assert.equal(channels[0].service, 'linkedin')
  assert.equal(channels[0].limit.supported, true)
  const instagram = channels.find((channel) => channel.service === 'instagram')
  assert.equal(instagram.limit.needsImage, true)
})

test('fixture trim shortens the draft without changing its facts', () => {
  assert.equal(trimFixture(DEMO_DRAFT), DEMO_TRIMMED)
  assert.ok(DEMO_TRIMMED.length < DEMO_DRAFT.length)
  assert.match(DEMO_TRIMMED, /twelve newsrooms/)
  assert.match(DEMO_TRIMMED, /https:\/\/example\.com\/notes\/three-years/)
})
