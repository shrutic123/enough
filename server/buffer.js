import crypto from 'node:crypto'
import {
  API_URL,
  AUTH_URL,
  CLIENT_ID,
  CLIENT_SECRET,
  HttpError,
  REDIRECT_URI,
  SCOPES,
  TOKEN_URL,
  withCause,
} from './config.js'

/* ------------------------------------------------------------- oauth flow */

// The verifier is the secret. Its SHA-256 digest is the challenge, and only the
// challenge is ever sent to Buffer — the verifier stays on this server until
// the token exchange, which is what makes a stolen authorization code useless.
export function createPkcePair() {
  const verifier = crypto.randomBytes(32).toString('base64url')
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

// Random value echoed back by Buffer on the callback. If it doesn't match what
// we handed out, the callback didn't come from a flow we started.
export function createState() {
  return crypto.randomBytes(16).toString('base64url')
}

export function buildAuthorizeUrl({ state, codeChallenge }) {
  const url = new URL(AUTH_URL)
  url.search = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code', // selects the Authorization Code flow
    scope: SCOPES, // space-separated
    state,
    code_challenge: codeChallenge, // the hash — never the verifier
    code_challenge_method: 'S256', // tells Buffer the challenge is a SHA-256 hash
    prompt: 'consent',
  }).toString()
  return url.toString()
}

// What the token endpoint's error codes usually mean in practice. Naming the
// likely cause saves the reader a trip through the OAuth spec.
const TOKEN_ERROR_HINTS = {
  invalid_client: 'set BUFFER_CLIENT_SECRET for a confidential client, or omit it entirely for a public one',
  invalid_grant: 'the code was already used or has expired, or redirect_uri differs from the authorize request',
  invalid_scope: 'a requested scope is not enabled on this app client',
  unsupported_grant_type: 'this client is not allowed to use that grant type',
}

// The authorization server advertises only "none" and "client_secret_post", so
// the secret always goes in the form body — never HTTP Basic.
async function requestTokens(params, previous = null) {
  const body = new URLSearchParams({ client_id: CLIENT_ID, ...params })
  if (CLIENT_SECRET) body.set('client_secret', CLIENT_SECRET)

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  const json = await res.json().catch(() => ({}))

  if (!res.ok || json.error) {
    const detail = json.error_description || json.error || `HTTP ${res.status}`
    const hint = TOKEN_ERROR_HINTS[json.error]
    const error = new Error(hint ? `${detail} — ${hint}` : detail)
    error.oauthError = json.error
    throw error
  }

  return {
    accessToken: json.access_token,
    // Buffer replaces a refresh token when it is used. Never retain the old
    // value after a successful refresh.
    refreshToken: json.refresh_token || null,
    scope: json.scope || previous?.scope,
    expiresAt: Date.now() + (Number(json.expires_in) || 3600) * 1000 - 30_000,
    connectedAt: previous?.connectedAt || Date.now(),
  }
}

// Trade the one-time code for tokens. This is where the code_verifier is
// finally revealed: Buffer re-hashes it, compares it to the challenge from the
// authorize step, and only trusts us if they match.
export async function exchangeCodeForTokens({ code, codeVerifier }) {
  const tokens = await requestTokens({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI, // must byte-match the authorize request
    code_verifier: codeVerifier,
  })
  if (!tokens.refreshToken) {
    throw new Error('Buffer did not return a refresh token; enable offline_access for this app client')
  }
  return tokens
}

export async function refreshTokens(previous) {
  const replacement = await requestTokens(
    {
      grant_type: 'refresh_token',
      refresh_token: previous.refreshToken,
    },
    previous,
  )

  // A replacement is required for a rotating-token flow. Continuing with the
  // old token would make a later failure hard to diagnose and unsafe to retry.
  if (!replacement.refreshToken) throw new Error('Buffer did not return a replacement refresh token')
  return replacement
}

// The gate every API call passes through. It saves a rotated token pair before
// returning, so the next request uses Buffer's replacement refresh token.
async function accessToken(ctx) {
  const tokens = ctx.session.tokens
  if (!tokens) throw new HttpError(401, 'Not connected to Buffer')
  if (Date.now() < tokens.expiresAt) return tokens.accessToken

  if (!tokens.refreshToken) {
    ctx.session.tokens = null
    await ctx.session.save()
    throw new HttpError(401, 'Your Buffer session expired. Connect again to continue.')
  }

  try {
    ctx.session.tokens = await refreshTokens(tokens)
    await ctx.session.save()
    return ctx.session.tokens.accessToken
  } catch (err) {
    console.warn(JSON.stringify({ event: 'buffer_token_refresh_failed', code: err.oauthError }))
    ctx.session.tokens = null
    await ctx.session.save()
    throw new HttpError(401, 'Your Buffer session expired. Connect again to continue.')
  }
}

/* --------------------------------------------------------------- graphql */
// Everything the app reads or writes goes through one GraphQL endpoint at
// https://api.buffer.com, with the access token in an Authorization header.

// Rate limits are per client, so every user of this app shares one quota. A
// well-behaved client reads Retry-After and backs off rather than hammering.
const MAX_BACKOFF_SECONDS = 5

export async function graphql(ctx, query, variables, { backedOff = false } = {}) {
  const token = await accessToken(ctx)
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  })
  const json = await res.json().catch(() => null)

  if (res.status === 401) {
    ctx.session.tokens = null
    await ctx.session.save()
    throw new HttpError(401, 'Buffer rejected the access token — reconnect')
  }

  if (res.status === 429) {
    const retryAfter = Number(res.headers.get('Retry-After')) || 0
    // Wait out a short reset once. A long one is not worth holding a request
    // open for — serverless functions bill wall-clock time and time out — so
    // it is reported instead, with the wait the API asked for.
    if (!backedOff && retryAfter > 0 && retryAfter <= MAX_BACKOFF_SECONDS) {
      await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000))
      return graphql(ctx, query, variables, { backedOff: true })
    }
    throw new HttpError(429, `Buffer API rate limit reached${retryAfter ? ` — try again in ${retryAfter}s` : ''}`)
  }

  // A GraphQL request that fails still comes back as HTTP 200. The real status
  // is in the `errors` array, under extensions.code.
  if (!res.ok || json?.errors?.length) {
    const failure = json?.errors?.[0]
    const code = failure?.extensions?.code
    console.error(JSON.stringify({ event: 'buffer_api_error', status: res.status, code, message: failure?.message }))
    throw new HttpError(
      502,
      withCause(
        'Buffer could not complete the request. Please try again.',
        [code, failure?.message].filter(Boolean).join(': ') || `HTTP ${res.status}`,
      ),
    )
  }
  return json.data
}

export const ACCOUNT_QUERY = `
  query Account {
    account {
      id
      email
      name
      organizations { id name }
    }
  }
`

// A "channel" is any social account connected to Buffer — a LinkedIn profile,
// an Instagram account, and so on. We scope the query to one organization.
export const CHANNELS_QUERY = `
  query Channels($organizationId: OrganizationId!) {
    channels(input: { organizationId: $organizationId }) {
      id
      name
      displayName
      service
      avatar
      isDisconnected
      isQueuePaused
    }
  }
`

// Scheduled/draft/error/needs-approval posts are what the queue screen shows.
// Deliberately no `sort` argument: the enum spelling is unverified, so the
// normalized posts are sorted by dueAt in JavaScript instead.
export const QUEUE_QUERY = `
  query Queue($organizationId: OrganizationId!, $first: Int!, $after: String) {
    posts(
      first: $first
      after: $after
      input: {
        organizationId: $organizationId
        filter: { status: [scheduled, draft, error, needs_approval] }
      }
    ) {
      edges {
        node {
          id
          text
          channelId
          dueAt
          status
          createdAt
          updatedAt
          assets { id type mimeType thumbnail source }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`

// `deletePost` has its own payload union, different from createPost:
// DeletePostSuccess | VoidMutationError. Spreading the wrong fragment fails
// schema validation, so this shape is deliberate.
export const DELETE_POST_MUTATION = `
  mutation DeletePost($input: DeletePostInput!) {
    deletePost(input: $input) {
      ... on DeletePostSuccess { id }
      ... on VoidMutationError { message }
    }
  }
`

// `createPost` is a different payload union from `deletePost`:
// PostActionSuccess | MutationError. Text, status and the channel come back on
// the created post so the client can confirm what was actually made.
export const CREATE_POST_MUTATION = `
  mutation CreatePost($input: CreatePostInput!) {
    createPost(input: $input) {
      ... on PostActionSuccess {
        post { id text status dueAt channelId }
      }
      ... on MutationError { message }
    }
  }
`

// Ported from Buffer's starter app. `assets: []` is required even with no
// media, and some networks reject a post without their metadata block.
export function buildPostInput({
  channelId,
  service,
  text,
  kind,
  schedulingType = 'automatic',
  imageUrl,
}) {
  const input = {
    channelId,
    text,
    // Instagram refuses a post without media. A public image link is enough:
    // Buffer fetches it. Other channels accept the same asset shape.
    assets: imageUrl ? [{ image: { url: imageUrl } }] : [],
    needsApproval: false,
    mode: 'addToQueue',
    schedulingType,
  }

  if (kind === 'draft') input.saveToDraft = true

  if (service === 'instagram') {
    input.metadata = { instagram: { type: 'post', shouldShareToFeed: true } }
  } else if (service === 'facebook') {
    input.metadata = { facebook: { type: 'post' } }
  } else if (service === 'googlebusiness') {
    input.metadata = { google: { type: 'whats_new' } }
  } else if (service === 'youtube') {
    input.metadata = { youtube: { title: text.split('\n')[0].slice(0, 100) } }
  }

  return input
}

// Join each post to its channel and trim it to the QueueCard contract in
// src/types.ts. A post with no text is still a real post: if it has media it
// stays in the review as an image or video, with the thumbnail shown.
export function normalizeQueue(posts, channels) {
  const byId = new Map(channels.map((channel) => [channel.id, channel]))

  return posts
    .map((post) => {
      const channel = byId.get(post.channelId)
      const asset = (post.assets || []).find(
        (candidate) => candidate?.thumbnail || candidate?.source,
      )
      const text = typeof post.text === 'string' ? post.text : ''
      return {
        id: post.id,
        text,
        channelId: post.channelId,
        channelName: channel?.displayName || channel?.name || '',
        service: channel?.service || '',
        dueAt: post.dueAt || null,
        status: String(post.status || '').toLowerCase(),
        asset: asset
          ? {
              thumbnail: asset.thumbnail || asset.source,
              source: asset.source || asset.thumbnail,
              type: String(asset.type || '').toLowerCase(),
            }
          : null,
      }
    })
    .filter((post) => post.text.trim() || post.asset)
    .sort((a, b) => dueAtTime(a.dueAt) - dueAtTime(b.dueAt))
}

function dueAtTime(value) {
  if (!value) return Infinity
  const time = Date.parse(value)
  return Number.isNaN(time) ? Infinity : time
}
