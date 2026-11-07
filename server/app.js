import express from 'express'
import { HttpError, REDIRECT_URI, loginUnavailableReason, withCause } from './config.js'
import { readSession } from './session.js'
import {
  ACCOUNT_QUERY,
  CHANNELS_QUERY,
  CREATE_POST_MUTATION,
  DELETE_POST_MUTATION,
  QUEUE_QUERY,
  buildAuthorizeUrl,
  buildPostInput,
  createPkcePair,
  createState,
  exchangeCodeForTokens,
  graphql,
  normalizeQueue,
} from './buffer.js'
import { aiProviderName, hasAiProvider, trimToEssence } from './ai.js'

const app = express()
app.use(express.json())

// Every route gets the session up front; routes that change it save explicitly.
app.use(async (req, res, next) => {
  try {
    req.session = await readSession(req, res)
    req.ctx = { req, res, session: req.session }
    next()
  } catch (err) {
    next(err)
  }
})

// Account data and authentication cookies must never be stored by a shared cache.
app.use('/api', (_req, res, next) => {
  res.set('Cache-Control', 'no-store, private')
  next()
})

// Lets a route throw HttpError and have it become a real response.
const wrap = (handler) => async (req, res, next) => {
  try {
    await handler(req, res)
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message })
    next(err)
  }
}

// A mutation must come from the app's own origin. The session cookie is
// SameSite=Lax, which already blocks cross-site form posts, and a cross-origin
// fetch cannot send JSON without a preflight. This check makes the intent
// explicit instead of relying on those two facts staying true.
function requireSameOrigin(req) {
  const origin = req.get('origin')
  if (!origin) return // same-origin navigations may omit it; Lax still applies
  const expected = REDIRECT_URI ? new URL(REDIRECT_URI).origin : null
  if (!expected || origin !== expected) {
    throw new HttpError(403, 'That request came from another site. Reload Enough and try again.')
  }
}

// Reading and writing Buffer data needs a connected session. Login itself is
// the only flow that runs without one.
function requireSession(req) {
  if (!req.session.tokens) throw new HttpError(401, 'Not connected to Buffer')
}

// Model output is untrusted text. Strip one markdown fence and one pair of
// wrapping quotes, then reject an empty text, a longer text, or a refusal.
// Anything accepted is no longer than the draft it came from.
function sanitizeTrimmed(value, original) {
  const failure = (message) => {
    const error = new Error(message)
    error.status = 502
    return error
  }

  if (typeof value !== 'string') throw failure('The provider returned no text')

  let trimmed = value.trim()

  const fence = trimmed.match(/^```[^\n]*\r?\n?([\s\S]*?)\r?\n?```$/)
  if (fence) trimmed = fence[1].trim()

  const quotePairs = { '"': '"', "'": "'", '“': '”', '‘': '’' }
  if (trimmed.length >= 2 && quotePairs[trimmed[0]] === trimmed[trimmed.length - 1]) {
    trimmed = trimmed.slice(1, -1).trim()
  }

  if (!trimmed) throw failure('The provider returned no text')
  if (trimmed.length > original.length) throw failure('The provider returned a longer text')
  if (/^(i can't|i cannot|sorry)/i.test(trimmed)) throw failure('The provider declined to trim the text')

  return trimmed
}

app.get(
  '/api/auth/login',
  wrap(async (req, res) => {
    // The login starts on the host that must also receive the callback.
    const unavailable = loginUnavailableReason(req.get('host'))
    if (unavailable) return res.redirect(`/?error=${encodeURIComponent(unavailable)}`)

    const { verifier, challenge } = createPkcePair()
    const state = createState()

    // Note the asymmetry: we keep the verifier and the state, and send out only
    // the challenge (the hash) and the state.
    req.session.pkce = { codeVerifier: verifier, state }
    await req.session.save()

    res.redirect(buildAuthorizeUrl({ state, codeChallenge: challenge }))
  }),
)

app.get(
  '/api/auth/callback',
  wrap(async (req, res) => {
    const { code, state, error, error_description: description } = req.query
    const pkce = req.session.pkce
    req.session.pkce = null // one-time values — discard either way

    if (error) {
      await req.session.save()
      return res.redirect(`/?error=${encodeURIComponent(description || error)}`)
    }

    // CSRF check: only a callback this app started carries the state we stored.
    // A missing session and a mismatched state have different causes, so they
    // get different messages.
    if (!pkce) {
      await req.session.save()
      return res
        .status(403)
        .send(
          'Session lost: this callback carries no record of the login that started it. ' +
            'Usually the server restarted between Connect and coming back here (a SESSION_SECRET that changes ' +
            'invalidates every session cookie), or the flow started on a different origin than ' +
            `${REDIRECT_URI} — localhost and 127.0.0.1 are separate cookie origins. Start again from the connect screen.`,
        )
    }
    if (state !== pkce.state) {
      await req.session.save()
      return res
        .status(403)
        .send('Invalid state parameter: this callback did not come from a login this app started.')
    }
    if (!code) {
      await req.session.save()
      return res.redirect(
        `/?error=${encodeURIComponent('Buffer did not return an authorization code. Start again from the connect screen.')}`,
      )
    }

    let tokens
    try {
      // The code is short-lived, so exchange it immediately.
      tokens = await exchangeCodeForTokens({ code, codeVerifier: pkce.codeVerifier })
    } catch (err) {
      console.error(
        JSON.stringify({ event: 'oauth_token_exchange_failed', code: err.oauthError, message: err.message }),
      )
      await req.session.save()
      const message = withCause('Buffer could not complete the connection. Check your client configuration.', err.message)
      return res.redirect(`/?error=${encodeURIComponent(message)}`)
    }

    try {
      req.session.tokens = tokens
      await req.session.save()
    } catch (err) {
      // Saving can fail because of the tokens themselves (a sealed cookie that
      // is too large, say), so drop them before saving the cleared session.
      req.session.tokens = null
      await req.session.save()
      throw err
    }
    res.redirect('/')
  }),
)

app.post(
  '/api/auth/logout',
  wrap(async (req, res) => {
    await req.session.destroy()
    res.json({ connected: false })
  }),
)

app.get(
  '/api/buffer/session',
  wrap(async (req, res) => {
    // redirectUri is echoed back for debugging: curl this endpoint to see the
    // exact callback the app will send, rather than guessing from Buffer's
    // generic error page.
    if (!req.session.tokens) return res.json({ connected: false, redirectUri: REDIRECT_URI })

    try {
      const data = await graphql(req.ctx, ACCOUNT_QUERY)
      res.json({
        connected: true,
        account: data.account,
        redirectUri: REDIRECT_URI,
        scope: req.session.tokens.scope,
      })
    } catch (err) {
      // An expired/revoked token is not an error page: it means reconnect.
      // graphql() has already cleared the tokens; save the cleared session.
      if (err.status === 401) {
        req.session.tokens = null
        await req.session.save()
        return res.json({ connected: false, redirectUri: REDIRECT_URI })
      }
      throw err
    }
  }),
)

app.get(
  '/api/buffer/channels',
  wrap(async (req, res) => {
    const organizationId = req.query.organizationId
    if (!organizationId || typeof organizationId !== 'string') {
      throw new HttpError(400, 'organizationId is required')
    }

    const data = await graphql(req.ctx, CHANNELS_QUERY, { organizationId })
    // Return disconnected channels too, with the flag, so the UI can explain
    // why an account is missing from the picker.
    res.json({ channels: data.channels })
  }),
)

app.get(
  '/api/buffer/queue',
  wrap(async (req, res) => {
    const organizationId = req.query.organizationId
    if (!organizationId || typeof organizationId !== 'string') {
      throw new HttpError(400, 'organizationId is required')
    }

    const requested = Number.parseInt(String(req.query.first ?? '50'), 10)
    const first = Number.isFinite(requested) ? Math.min(50, Math.max(1, requested)) : 50

    // Run one at a time, not with Promise.all: both calls share this session,
    // and two concurrent expired-token refreshes would rotate the refresh token
    // twice and revoke the grant.
    const queue = await graphql(req.ctx, QUEUE_QUERY, { organizationId, first })
    const channels = (await graphql(req.ctx, CHANNELS_QUERY, { organizationId })).channels

    const posts = (queue.posts?.edges || []).map((edge) => edge.node)
    res.json({ posts: normalizeQueue(posts, channels) })
  }),
)

app.post(
  '/api/buffer/cut',
  wrap(async (req, res) => {
    requireSameOrigin(req)

    const postId = req.body?.postId
    if (typeof postId !== 'string' || !postId.trim() || postId.length > 200) {
      throw new HttpError(400, 'postId is required')
    }

    // The id belongs to the signed-in user's own queue, so the session is the
    // authorization boundary. Buffer owns the final check: an id that is gone
    // or not theirs comes back as a typed mutation error.
    const data = await graphql(req.ctx, DELETE_POST_MUTATION, {
      input: { id: postId.trim() },
    })
    const result = data?.deletePost

    if (!result || typeof result.id !== 'string') {
      throw new HttpError(
        502,
        withCause(
          "Buffer couldn't delete that post. Try again.",
          typeof result?.message === 'string' ? result.message : undefined,
        ),
      )
    }

    res.json({ ok: true })
  }),
)

app.post(
  '/api/ai/essence',
  wrap(async (req, res) => {
    requireSession(req)

    const raw = req.body?.text
    if (typeof raw !== 'string' || !raw.trim()) {
      throw new HttpError(400, 'Paste a draft first.')
    }
    const text = raw.trim()
    if (text.length > 4000) {
      throw new HttpError(400, 'That draft is too long. Keep it under 4,000 characters.')
    }

    if (!hasAiProvider()) {
      throw new HttpError(
        503,
        withCause(
          "Trimming isn't available right now. Your draft is unchanged.",
          'set GEMINI_API_KEY, OPENAI_API_KEY or ANTHROPIC_API_KEY',
        ),
      )
    }

    let trimmed
    try {
      trimmed = sanitizeTrimmed(await trimToEssence(text), text)
    } catch (err) {
      // The draft and the key never appear in a log line.
      console.warn(
        JSON.stringify({
          event: 'ai_essence_failed',
          provider: err.provider || aiProviderName(),
          status: Number.isFinite(err.status) ? err.status : 0,
        }),
      )
      throw new HttpError(
        502,
        withCause("The trim didn't come back. Your draft is unchanged.", err.message),
      )
    }

    res.json({ trimmed })
  }),
)

app.post(
  '/api/buffer/create',
  wrap(async (req, res) => {
    requireSameOrigin(req)
    requireSession(req)

    const {
      kind,
      text: rawText,
      channelId: rawChannelId,
      organizationId: rawOrganizationId,
      imageUrl: rawImageUrl,
    } = req.body || {}

    if (kind !== 'scheduled' && kind !== 'draft') {
      throw new HttpError(400, 'Choose where this should go.')
    }
    if (typeof rawText !== 'string' || !rawText.trim()) {
      throw new HttpError(400, 'Paste a draft first.')
    }
    const text = rawText.trim()
    if (text.length > 4000) {
      throw new HttpError(400, 'That draft is too long. Keep it under 4,000 characters.')
    }
    if (typeof rawChannelId !== 'string' || !rawChannelId.trim()) {
      throw new HttpError(400, 'Pick a channel first.')
    }
    if (typeof rawOrganizationId !== 'string' || !rawOrganizationId.trim()) {
      throw new HttpError(400, 'organizationId is required')
    }

    const channelId = rawChannelId.trim()
    const organizationId = rawOrganizationId.trim()

    // Optional. Buffer fetches the URL itself, so only the shape is checked
    // here: a full http(s) link, not a data URI or a local path.
    let imageUrl
    if (typeof rawImageUrl === 'string' && rawImageUrl.trim()) {
      imageUrl = rawImageUrl.trim()
      if (imageUrl.length > 2000) {
        throw new HttpError(400, 'That image link is too long. Use one under 2,000 characters.')
      }
      let parsed
      try {
        parsed = new URL(imageUrl)
      } catch {
        throw new HttpError(400, 'That image link is not a full URL. Use a public https link.')
      }
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        throw new HttpError(400, 'That image link is not a full URL. Use a public https link.')
      }
    } else if (rawImageUrl !== undefined && rawImageUrl !== null && typeof rawImageUrl !== 'string') {
      throw new HttpError(400, 'That image link is not a full URL. Use a public https link.')
    }

    // Fetch the channel rather than trusting the service posted by the client:
    // metadata and the channel's existence both depend on Buffer's answer.
    const channels = (await graphql(req.ctx, CHANNELS_QUERY, { organizationId })).channels || []
    const channel = channels.find((candidate) => candidate.id === channelId)
    if (!channel) {
      throw new HttpError(404, 'That channel is no longer connected. Pick another one.')
    }

    let schedulingType = 'automatic'
    let data = await graphql(req.ctx, CREATE_POST_MUTATION, {
      input: buildPostInput({
        channelId: channel.id,
        service: channel.service,
        text,
        kind,
        schedulingType,
        imageUrl,
      }),
    })
    let post = data?.createPost?.post
    let message = data?.createPost?.message

    // Instagram personal profiles cannot publish through the API. Buffer asks
    // for notification scheduling instead: it reminds the person to post at the
    // slot. That is the only accepted mode, so retry once rather than failing a
    // post Buffer is willing to take. A MutationError means nothing was created,
    // so the retry cannot duplicate it.
    if (
      !post &&
      kind === 'scheduled' &&
      typeof message === 'string' &&
      /notification scheduling/i.test(message)
    ) {
      schedulingType = 'notification'
      data = await graphql(req.ctx, CREATE_POST_MUTATION, {
        input: buildPostInput({
          channelId: channel.id,
          service: channel.service,
          text,
          kind,
          schedulingType,
          imageUrl,
        }),
      })
      post = data?.createPost?.post
      message = data?.createPost?.message
    }

    if (!post || typeof post.id !== 'string') {
      throw new HttpError(
        502,
        withCause(
          "Buffer couldn't create that post. Your text is still here. Try again, or save it as a draft.",
          typeof message === 'string' ? message : undefined,
        ),
      )
    }

    res.json({
      post: {
        id: post.id,
        text: post.text,
        status: String(post.status || '').toLowerCase(),
        dueAt: post.dueAt || null,
        channelId: post.channelId,
        schedulingType,
      },
    })
  }),
)

// Misconfiguration (a missing SESSION_SECRET, for instance) should read as a
// clear message instead of an opaque platform 500.
app.use((err, _req, res, next) => {
  // Too late for a clean response; let Express close the connection.
  if (res.headersSent) return next(err)
  console.error(JSON.stringify({ event: 'unhandled_request_error', name: err.name, message: err.message }))
  res.status(500).json({ error: 'Something went wrong. Please try again.' })
})

export default app
