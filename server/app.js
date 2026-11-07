import express from 'express'
import { HttpError, REDIRECT_URI, loginUnavailableReason, withCause } from './config.js'
import { readSession } from './session.js'
import {
  ACCOUNT_QUERY,
  CHANNELS_QUERY,
  DELETE_POST_MUTATION,
  QUEUE_QUERY,
  buildAuthorizeUrl,
  createPkcePair,
  createState,
  exchangeCodeForTokens,
  graphql,
  normalizeQueue,
} from './buffer.js'

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

// Misconfiguration (a missing SESSION_SECRET, for instance) should read as a
// clear message instead of an opaque platform 500.
app.use((err, _req, res, next) => {
  // Too late for a clean response; let Express close the connection.
  if (res.headersSent) return next(err)
  console.error(JSON.stringify({ event: 'unhandled_request_error', name: err.name, message: err.message }))
  res.status(500).json({ error: 'Something went wrong. Please try again.' })
})

export default app
