# Enough — Technical Architecture

**Status:** living draft, v0.2, Nov 6 2026.
**Source of truth:** the code. This document is reconciled after each session.
**Related:** [PRD](PRD.md), [BUILD_LOG](../BUILD_LOG.md), [README](../README.md).

Legend: **[built]** exists in the repo, **[planned]** agreed but not built, **[open]** needs a decision or verification.

---

## 1. System overview

```
Browser (React + Vite)                    [built]
   │  same-origin fetch, no tokens
   ▼
/api  (one Express app)                   [built]
   ├─ /api/auth/*     OAuth 2.0 + PKCE, session cookie   [built]
   ├─ /api/buffer/*   account, channels, queue reads     [built]
   └─ /api/ai/*       AI calls, provider key server-side [built]
   │
   ├──► Buffer GraphQL  https://api.buffer.com           [built]
   ├──► Buffer OAuth    https://auth.buffer.com/auth, /token  [built]
   └──► AI provider                                      [built]
```

Two hosting modes, one server codebase:

- **Local [built]:** Vite dev server on `https://localhost:5173`, Express on `http://localhost:3001`, Vite proxies `/api` to Express. One browser origin, so the session cookie and the OAuth callback share a host.
- **Production [built but unverified]:** Vercel serves the Vite build as static files and runs the same Express app as one serverless function at `/api`. The rewrite has not been exercised on a live deployment.

## 2. Repository layout

```text
enough/
  api/index.js                  Vercel entry: re-exports server/app.js; never listens
  server/
    app.js                      Express app: session middleware, routes, error handler
    limits.js                   per-network length and media rules, checked before create
    index.js                    local listener only (Node --watch)
    config.js                   env loading, redirect URI, host guard, scopes, session secret
    session.js                  iron-session wrapper
    buffer.js                   PKCE, token exchange/refresh, GraphQL client, queries
    ai.js                       provider seam: Gemini, OpenAI or Anthropic by key presence
    limits.js                   per-network length and media rules, checked before create
  src/
    main.tsx                    React entry
    App.tsx                     session load, dev demo bypass, Connect vs Queue
    types.ts                    client/server contract
    lib/api.ts                  typed fetch helpers (session, channels, queue, cut, trim, create)
    lib/diff.ts                 word-level LCS diff, computed in the browser
    lib/format.ts               date, subline, counts, network labels
    pages/Connect.tsx           connect screen
    pages/Queue.tsx             review session and motion state machine
    pages/End.tsx               end screen
    pages/Essence.tsx           trim, diff, optional image URL, send to Buffer
    components/QueueCard.tsx    one card, Keep/Cut, thumbnail, network
    components/WordDiff.tsx     pencil-mark rendering for removed words
    hooks/useReducedMotion.ts   matchMedia listener
    fixtures/cards.ts           dev-only demo cards
    styles/app.css              Tailwind directives + app rules
  enough.css                    design tokens and motion (pre-existing)
  tailwind.config.js            tokens mapped to CSS vars (pre-existing)
  docs/                         PRD, architecture, deploy notes
  vercel.json                   build/output + /api rewrite
  .env.example                  placeholders only
```

**Decision:** one Express function at `/api`, not eight separate serverless files. The OAuth/session code is shared, and there are fewer cold starts. The README maps features to files instead of relying on a one-function-per-endpoint tree.

**Decision:** server in plain JavaScript ESM (ported from the Buffer starter, lower risk); client in TypeScript (the UI has real state and motion).

## 3. Local development

| Piece | Value |
|---|---|
| Node | 22.x (`package.json` engines) |
| Browser origin | `https://localhost:5173` |
| Vite dev server | 5173, HTTPS via `@vitejs/plugin-basic-ssl`, `strictPort: true` |
| Express | `http://localhost:3001` |
| Vite proxy | `/api` → `http://localhost:3001`, **`changeOrigin: false`** |
| Redirect URI | `https://localhost:5173/api/auth/callback` |
| Scripts | `npm run dev` (`concurrently`: `node --watch server/index.js` + `vite`), `npm run typecheck`, `npm run build` |

`changeOrigin: false` matters: the login route compares the request `Host` with the redirect URI host, so the proxy must preserve `Host: localhost:5173`.

Buffer requires HTTPS even on localhost and compares redirect URIs character for character. The localhost URI must be registered on the app client alongside the production URI.

`.env` is read with `process.loadEnvFile()` only when `NODE_ENV !== 'production'`. A deployed host's real environment always wins.

## 4. Authentication

### Flow **[built, browser-tested]**

1. `GET /api/auth/login`
   - Check the request `Host` against the redirect URI host. On mismatch or a deployment with no callback, redirect to `/?error=<explanation>` — login never starts from the wrong origin.
   - Generate a PKCE verifier (32 random bytes, base64url) and a `state` (16 random bytes, base64url).
   - Store `{ codeVerifier, state }` under `session.pkce`; save the session before redirecting.
   - Redirect to `https://auth.buffer.com/auth` with `client_id`, `redirect_uri`, `response_type=code`, `scope`, `state`, `code_challenge`, `code_challenge_method=S256`, `prompt=consent`.
2. `GET /api/auth/callback`
   - Read `code`, `state`, `error` from the query.
   - Clear `session.pkce` first: the values are one-time either way.
   - `error` from Buffer → redirect to `/?error=<description or error>`.
   - No stored `pkce` → 403 plain text ("Session lost…"), because the callback cannot be tied to a login this server started.
   - `state` mismatch → 403 plain text ("Invalid state parameter…").
   - Missing `code` → redirect to `/?error=…`.
   - Exchange the code at `https://auth.buffer.com/token`. The secret goes in the **form body** (`client_secret_post`), never HTTP Basic: `client_id`, `client_secret` (when configured), `grant_type=authorization_code`, `code`, `redirect_uri`, `code_verifier`.
   - Save `{ accessToken, refreshToken, scope, expiresAt, connectedAt }` in the session; redirect to `/`. If saving the sealed cookie fails (for example, it is too large), the tokens are dropped and the cleared session is saved before rethrowing.
3. `POST /api/auth/logout` — destroy the session; return `{ connected: false }`. No UI calls this yet.

### Session **[built]**

- `iron-session` v9, cookie name `enough_session`.
- `httpOnly: true`, `secure: true`, `sameSite: 'lax'`, `path: '/'`, 30-day TTL.
- The cookie is sealed with `SESSION_SECRET` (32+ characters, trimmed).
  - Development: if the secret is missing or too short, use `.session-key` in the repo root (created `0600`, gitignored) so restarts do not invalidate a login. If the file cannot be written, fall back to a per-boot key and warn.
  - Production: throw at module load if the secret is missing or shorter than 32 characters. This is a startup failure, not a graceful JSON error.
- `BUFFER_CLIENT_ID` is required in every environment (`config.js` throws without it). `BUFFER_CLIENT_SECRET` is optional for a public client.
- Tokens never leave the server. The server returns `{ connected, account?, redirectUri, scope? }`; `scope` is only present when connected and is not yet used by the client.

### Refresh and rate limits **[built]**

- `expiresAt = now + (expires_in || 3600) * 1000 - 30_000`.
- One helper, `accessToken(ctx)`, gates every Buffer call. Refresh tokens are single-use: a successful refresh must return a replacement, and the session is saved before the new token is used.
- On a failed refresh: clear tokens, save, return 401 "Your Buffer session expired. Connect again to continue."
- On a GraphQL 401: clear tokens, save, return 401 "Buffer rejected the access token — reconnect".
- On 429: read `Retry-After`; retry once only when the wait is short (≤5 seconds). Otherwise return 429 with the wait. Rate limits are per app client, so all users share the quota.

### Redirect URI **[built; local registered, production pending]**

- Development default: `https://localhost:5173/api/auth/callback`.
- `REDIRECT_URI` overrides it. Values are trimmed, a non-HTTPS URL warns, and an unparseable value falls back to the default with a warning.
- On Vercel, the **production** deployment defaults to `https://${VERCEL_PROJECT_PRODUCTION_URL}/api/auth/callback`. Preview deployments get `null`, so login is disabled there unless `REDIRECT_URI` is set for that preview.
- Non-Vercel production uses `VERCEL_PROJECT_PRODUCTION_URL` if present; otherwise `null` and login is disabled.
- `loginUnavailableReason()` compares the request host exactly to the callback host. `localhost` and `127.0.0.1` are different hosts.

### Scopes

| Scope | State | Used for |
|---|---|---|
| `account:read` | **requested** | account, organizations |
| `posts:read` | **requested** | queue read |
| `posts:write` | **requested** | Cut; later edit and create |
| `offline_access` | **requested** | refresh token |
| `ideas:read` | planned | Essence → idea destination |
| `ideas:write` | planned | create an idea |

`SCOPES` is exactly `account:read posts:read posts:write offline_access`. Adding the idea scopes requires enabling them on the app client and re-consenting.

## 5. Buffer GraphQL layer

- Endpoint: `https://api.buffer.com` (POST, JSON `{query, variables}`).
- Header: `Authorization: Bearer <access token>`.
- A GraphQL failure is usually HTTP 200 with an `errors` array; it becomes a 502 with `extensions.code` plus `message` appended only in development.
- A typed mutation failure would be data, not an exception (`... on MutationError { message }`). No mutation is wired yet.
- Channels are fetched on every queue request; there is **no cross-request cache**.
- `organizationId` comes from the client query string. The server does not independently verify organization membership; the id is passed to Buffer and the result is whatever that token can read. Mutations must re-validate post ids against a freshly fetched queue when they are built.

### Account **[built]**

```graphql
query Account {
  account {
    id
    email
    name
    organizations { id name }
  }
}
```

### Channels **[built]**

```graphql
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
```

`channels` returns a list (not a cursor connection). The endpoint returns disconnected channels too, with the flag, so the UI can explain missing accounts; there is no channel picker yet.

### Queue **[built]**

```graphql
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
```

- **No `sort` argument.** The `SortDirection` spelling is unverified, so `normalizeQueue()` sorts by `dueAt` in JavaScript: ascending, with missing/unparseable dates last.
- `first` comes from `?first=`, default 50, clamped to 1..50. The client does not send it, so the server fetches 50. `after` is declared but never sent: only the first page is read.
- Each post is joined server-side to the channel list: `channelName = displayName || name || ''`, plus `service`. The card names the network (`Instagram`, `LinkedIn`) before the account name, so a handle alone never has to identify the site.
- The first asset, if any, becomes `asset = { thumbnail, source, type }` and renders as a 96px thumbnail on the card.
- Posts with no text are kept when they have media: the card labels them "Image post" or "Video post". Only a post with neither text nor an asset is skipped.
- Status is lowercased into the `PostStatus` union.
- The client sorts again by `dueAt` (nulls last) and caps the review at 20 cards.

### Cut **[built]**

```graphql
mutation DeletePost($input: DeletePostInput!) {
  deletePost(input: $input) {
    ... on DeletePostSuccess { id }
    ... on VoidMutationError { message }
  }
}
```

`DeletePostPayload` is a union of `DeletePostSuccess | VoidMutationError`, not the generic `MutationError`. The route returns `{ ok: true }` only when Buffer returns a deleted id; a typed error becomes a 502 with "Buffer couldn't delete that post. Try again." The client draws the pencil while the request is in flight and dissolves the card only after it resolves, so a failure never implies a delete that did not happen.

`DeletePostInput` is `{ id: PostId! }`. The signed-in session is the authorization boundary: the id belongs to the user's own queue, and Buffer rejects an id that is not theirs. The route additionally requires a same-origin request. It does not re-fetch the queue before deleting, so a post removed elsewhere still returns Buffer's typed error rather than a local "not found".

### Create **[built]**

```graphql
mutation CreatePost($input: CreatePostInput!) {
  createPost(input: $input) {
    ... on PostActionSuccess {
      post { id text status dueAt channelId }
    }
    ... on MutationError { message }
  }
}
```

- Required: `channelId`, `text`, `assets`, `needsApproval: false`, `mode`, `schedulingType`.
- `assets` is `[]` for a text-only post, or `[{ image: { url } }]` when an optional public image URL is supplied. Buffer fetches the URL; the server validates only the shape (`http`/`https`, under 2,000 characters).
- `schedulingType` starts as `automatic`. Instagram personal profiles refuse that and ask for `notification`, so the route retries once with `notification` when Buffer's typed error says so. The response returns the mode actually used, and the confirmation says Buffer will remind the person to post.
- `saveToDraft: true` requires a channel and makes the status `draft`.
- Per-network metadata is required for some services (Instagram `{type:"post", shouldShareToFeed:true}`, Facebook `{type:"post"}`, Google Business `{type:"whats_new"}`). Reuse the starter's `buildPostInput` mapping.
- `mode`: `addToQueue` only in v1. There is no custom time picker, so `customScheduled` and `dueAt` are not used.
- YouTube needs a title and video, so creation is blocked before Buffer is called.

### Idea **[planned]**

```graphql
mutation CreateIdea($input: CreateIdeaInput!) {
  createIdea(input: $input) {
    ... on Idea { id content { title text } }
    ... on MutationError { message }
  }
}
```

`CreateIdeaInput`: `{ organizationId, content: { title, text } }`. There is no update or delete idea mutation; ideas are create-only.

### Merge **[planned, stretch]**

`editPost(input: { id, text })` → then `deletePost`. Only same-channel near-duplicates. If the edit succeeds and the delete fails, the user sees "The text was combined, but the duplicate wasn't deleted. Try again." Do not roll back by editing again.

## 6. Internal API surface

All JSON responses use `{ "error": "sentence-case message" }` with the matching HTTP status, except the browser-facing auth routes, which redirect or return plain text on a bad callback.

| Method | Path | Body / query | Response | Status |
|---|---|---|---|---|
| GET | `/api/auth/login` | — | 302 to Buffer, or 302 to `/?error=` | **built** |
| GET | `/api/auth/callback` | `code`, `state`, `error?` | 302 to `/` or `/?error=`; 403 on a bad callback | **built** |
| POST | `/api/auth/logout` | — | `{ connected: false }` | **built** |
| GET | `/api/buffer/session` | — | `{ connected, account?, redirectUri, scope? }` | **built** |
| GET | `/api/buffer/channels` | `organizationId` (required) | `{ channels }`, each with `limit` | **built** |
| GET | `/api/buffer/queue` | `organizationId` (required), `first?` | `{ posts: QueueCard[] }` | **built** |
| POST | `/api/buffer/cut` | `{ postId }` | `{ ok: true }` | **built** |
| POST | `/api/buffer/create` | `{ kind, text, channelId, organizationId, imageUrl? }` | `{ post }` | **built** |
| POST | `/api/ai/essence` | `{ text }` | `{ trimmed }` | **built** |

There is no queue-audit endpoint and no idea endpoint in v1.

`/api/buffer/session` returns `connected: false` (not an error) when there are no tokens or Buffer rejects them; this is the reconnect path.

Client contract in `src/types.ts`:

```ts
type PostStatus = 'draft' | 'error' | 'needs_approval' | 'scheduled' | 'sending' | 'sent'

type QueueCard = {
  id: string
  text: string
  channelId: string
  channelName: string
  service: string
  dueAt: string | null
  status: PostStatus
  asset?: { thumbnail: string; source: string; type: string } | null
}
```

`/api/buffer/session` echoes `redirectUri` on purpose: curl it to see the exact string the server will send, instead of guessing from Buffer's generic error page.

## 7. Client architecture

- No router **[built]**. `App.tsx` loads the session once, then renders `Connect` or `Queue`. `Queue` owns the review and renders `End` when the cards run out. `Queue` also holds a `writing` flag: it swaps its screen for `EssencePage` without unmounting, so review progress survives a detour into the editor.
- `Queue.tsx` holds the whole review session in local state: load status, the capped card list, index, done, kept/cut totals, the motion phase and visual flags, and the live-region message. There is no store and no `useQueue` hook.
- The first organization on the account is selected automatically (`session.account.organizations[0]`). There is no organization picker. `getChannels()` feeds the Essence channel select and carries each channel's network limit.
- Read state is fetched, not duplicated. The queue is a snapshot taken on load; a refresh re-reads Buffer.
- Keep makes no API call. Cut calls `POST /api/buffer/cut` and removes the card from local state only after the server confirms. A failed Cut keeps the card and shows the error in its reason line; the queue is untouched.
- Errors render in place with a Try again action, not as alerts. A failed queue load also offers Reconnect.
- `?demo=1` is a development-only fixture path. In `App.tsx`, `import.meta.env.DEV && ?demo=1` skips the session fetch and renders `QueuePage` with a fake session; `Queue.tsx` then loads `src/fixtures/cards.ts` instead of calling the API. `import.meta.env.DEV` is false in production builds, so the path cannot ship as a fake success.
- Reduced motion is read with `useReducedMotion()` (a `matchMedia` listener), not only by CSS.

## 8. AI layer **[built]**

`server/ai.js` is the only AI code. The provider is whichever key is present, in order: `GEMINI_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`. `AI_MODEL` overrides the model. Defaults: `gemini-3.5-flash-lite`, `gpt-4.1-mini`, `claude-sonnet-4-5`. No key → `503` with a sentence that says the draft is unchanged.

### Essence

- `POST /api/ai/essence` takes `{ text }` only. Input is trimmed and capped at 4,000 characters.
- The prompt asks for the trimmed text only: keep the one idea, delete filler and repetition, add nothing, preserve voice, @mentions and URLs.
- The response is sanitized server-side: one surrounding code fence or quote pair is removed; empty output, output longer than the input, and obvious refusals are rejected. Failure → `502` "The trim didn't come back. Your draft is unchanged."
- The **client** computes the word-level diff (`src/lib/diff.ts`, LCS over word tokens) between the original and the trimmed text. This guarantees a pencil mark can only land on a word that is actually gone. The model never returns indices.
- The result stays editable. Editing the draft retires the previous result, so no mark can describe stale text.

### Create constraints

- `POST /api/buffer/create` validates the channel, then `server/limits.js` checks the network's character limit and media requirement before Buffer is called. Its refusals are turned into a sentence that names the network and the limit.
- `assets` is `[]`, or `[{ image: { url } }]` when the optional image URL is supplied. Instagram requires one; TikTok, YouTube and Pinterest need video or a board, so this version blocks them with a reason.
- `schedulingType` starts as `automatic`; Instagram personal profiles require `notification`, so the route retries once when Buffer says so. The response records the mode used, and the confirmation says Buffer will remind the person to post.

There is no queue audit. Deterministic reasons (error status, a past `dueAt`) are the whole reason set.

## 9. Motion implementation

### Cut **[built]**

`Queue.tsx` runs a four-phase machine: `idle → striking → leaving → collapsing → idle`.

1. **Strike** (`striking`): add `.on` to `.struck`; the pencil line draws for **220ms**. At the same moment, `cutPost()` starts. The card does not move until Buffer confirms the delete.
2. **Leave** (`leaving`): once the delete resolves and the strike has had its 220ms, add `.is-gone`; the words leave in **160ms** and the blank sheet crumples for **520ms**. A **720ms** timer is the safety net if `animationend` never fires. The current crumple is a clipped, creased sheet that folds inward; it is not a scale-down. Reduced motion uses a 160ms `crumple-fade`.
3. **Collapse** (`collapsing`): add `.collapsed` to the wrapping `.slot` (grid row `1fr → 0fr`, **280ms**).
4. **Advance**: after 280ms, clear timers, increment the cut total, announce "Cut. N left.", reset the visual flags, advance the index, and move focus to the next card's Keep button.

If the delete fails, the timers are cleared, `.struck.on` is removed, the phase returns to `idle`, the card stays, and the error replaces the reason line (`role="alert"`) and is announced. Reduced motion: strike wait 0ms, crumple fallback 160ms, collapse wait 0ms. Focus and the announcement still happen.

### Keep **[built]**

`idle → leaving` directly: add `.is-kept`; the sheet lifts 5px, slides down 16px and shrinks slightly (**220ms**) as it returns under the pile, while a graphite "kept" note fades in the left page margin and out by 460ms. Then collapse the slot (**280ms**), then advance. The two paper edges behind the card fade when the decision starts. Reduced motion waits 120ms for an opacity-only fade, then collapses immediately. Keep makes no API call and counts toward "kept".

### Queue composition **[built]**

- The card is `.sheet`; while more than one card remains, `.sheet-stack.stacked` shows two 1px outlined sheets offset 6px and 14px below it. They are transparent outlines, not box shadows, so they read as paper edges. When the last card arrives, the edges fade and the 16px stack padding closes over 220ms.
- `.queue-progress` is a 120px hairline; the graphite segment is `remaining / total` wide and transitions in 280ms. It is `aria-hidden`; the "N left" text remains the accessible count.
- The "kept" note is hidden below 900px, where there is no page margin; the settle motion carries the beat there.
- The review screen is anchored at the top (`.stage.review-stage`) rather than vertically centered. The count, the progress hairline and the sheet's top edge keep a fixed page position while card heights change; a long post grows downward instead of pushing the header up.
- The card keeps its natural height. There is no internal scrollbar: a long post is a taller sheet, and the page scrolls only when the sheet exceeds the viewport.

### Sound **[built]**

- The crumple sound is synthesized in `src/lib/sound.ts`: a dense series of 150 tiny band-passed noise snaps (1.5-6 ms) over 0.36 s, with a few slightly longer folds, plus a short room tail. This is the auditioned candidate the user chose; it reads as paper folding rather than water or a tap. Master gain **0.3**; about −22 dBFS peak, −47 dBFS RMS. No audio file ships.
- It is primed on the Cut click (the gesture that permits audio) and played in `beginLeaving`, i.e. only after Buffer confirms the delete. Keep, entry, hover and a failed Cut are silent.
- Turning the toggle on previews the same rustle at 0.75 gain, so the setting is audible before the next cut. Turning it off is silent.
- It returns early when the tab is hidden, so a background tab cannot make noise.
- Focus: when a cut begins, focus moves to the Cut button before the strike and crumple, so the ring names the decision in flight. A small input-modality tracker (`src/hooks/useInputModality.ts`) forces the focus ring on after keyboard input, covering browsers that keep it suppressed after a pointer click.
- A text toggle in the queue header shows `Sound off` / `Sound on`, with an `aria-label` that names the action. The preference is stored under `enough.sound` in `localStorage`; blocked storage reads fall back to sound on and blocked writes are ignored.
- `npm test` (Node's built-in runner) covers the preference helpers, including the blocked-storage cases.

### Guards and accessibility **[built]**

- `phaseRef` and `indexRef` reject a second decision while a phase is running; repeated keydowns are ignored.
- `K` / `C` are ignored when the event has modifiers, repeats, comes from an input/textarea/select/contentEditable, or the screen is loading/done.
- Each card is an `<article>` with real `<button>` actions; the `K`/`C` hints are `<kbd aria-hidden="true">`.
- The Keep button is ref-forwarded; after advance, an effect focuses the next card's Keep button.
- A visually hidden `aria-live="polite"` region announces "Kept. N left." or "Cut. N left."
- The card carries `aria-busy` while a phase runs, and both actions carry `aria-disabled` so they stay focusable but ignore input mid-phase.
- `useReducedMotion()` feeds the JS timers; `enough.css` also reduces all animations to 120ms and transitions to 1ms.

### Essence **[built]**

1. `trimEssence` resolves → the client computes `diffText(draft, trimmed)` and renders the diff paragraph with `word cut` spans, no `.on`/`.gone`.
2. On the next animation frame, `collapsed` flips: spans become `word cut on gone`. The CSS draws the pencil for **220ms**, then collapses each mark after `220ms + index*25ms` (320ms max-width, 240ms opacity).
3. The swap to the editable result is timed from the cut count: `220 + (cuts-1)*25 + 320 + 60`, capped at 2,200ms. Reduced motion flips immediately and swaps in 0ms; the global media query removes the transitions.
4. Editing the draft cancels the frame/timer and clears the result, so marks never describe stale text.

The word count stays visible during the swap ("N words to M."). The result textarea is read-only only while sending.

### End **[built]**

`.enough` uses the existing `settle` animation (`900ms`, letter-spacing tightens). The reduced-motion rule uses a dedicated `fade-in-only` keyframe. The heading receives focus on mount (`tabIndex={-1}`). Actions are "Back to Buffer" and "Start over" (a page reload), not "Review again".

### CSS fixes (resolved)

- `.word.cut` now has a `background-size` transition like `.struck`; the line draws rather than appearing instantly.
- `.word` uses `max-width: 100%`, so long words are not clipped at rest.
- The reduced-motion `.enough` override is a clean `fade-in-only` fade, not `animation-direction: reverse`; letter-spacing is held constant so tracking does not animate.

## 10. Security

- OAuth `state` is one-time and verified; the PKCE verifier never leaves the server. **[built]**
- Session cookie is encrypted and HttpOnly; no tokens in client JS, `localStorage` or `sessionStorage`. **[built]**
- `Cache-Control: no-store, private` is set on every `/api` route. **[built]**
- The browser never sends a Buffer token. It does send `organizationId` and a `postId`. The session authorizes both; Buffer rejects an id that is not the user's. There is no server-side check that `organizationId` belongs to the account, because Buffer scopes the response to the token anyway. **[built]**
- CSRF: the OAuth callback is a top-level GET protected by `state`. `SameSite=Lax` blocks cross-site form posts, and `POST /api/buffer/cut` additionally requires the request `Origin` to match the registered callback's origin. A cross-origin JSON fetch cannot skip the preflight. **[built]**
- Rate limits are per app client and shared by all users; the client backs off once for a short wait. **[built]**
- `.env` is gitignored; `.env.example` contains placeholders only. Tokens and full auth headers are never logged. **[built]**
- In production, a missing or short `SESSION_SECRET` fails startup loudly rather than silently generating per-instance keys. **[built]**

## 11. Observability and debugging

- Structured JSON logs exist for `oauth_token_exchange_failed`, `buffer_token_refresh_failed`, `buffer_api_error`, and `unhandled_request_error`. They log event, status/code and message — never the token or auth header. **[built]**
- `/api/buffer/session` echoes `redirectUri` to debug character-level mismatches. **[built]**
- Development error messages append the underlying cause via `withCause()`; production keeps the cause out of the response. **[built]**
- Buffer's explorer (`developers.buffer.com/explorer.html`) is the reference for field names; do not guess. The sample app (`bufferapp/buffer-sample-apps`, `samples/app-client-starter-app`) is the reference for OAuth, refresh, 429 handling and `createPost` required fields.
- AI failures are not logged yet because the AI layer is not built.

## 12. Verification

No automated test suite in v1.

Build checks:

1. `npm run typecheck` (`tsc -b`).
2. `npm run build` (`tsc -b && vite build`).

Manual checks, run against a real Buffer account:

1. Local connect → consent → back → queue loads. **Done.**
2. Queue returns real posts, sorted by `dueAt`, at most 20 cards, with media and network shown. **Done.**
3. Keep makes no API call and advances. **Done.**
4. Cut deletes the post in Buffer. **Done.**
5. A failed Cut keeps the card and shows the error in place. **Built; not deliberately exercised.**
6. End screen shows "Enough." with kept/cut totals and receives focus. **Done.**
7. `?demo=1` shows the fixture cards with no session. **Done.**
8. Reduce motion: no strike wait or slide, state still updates. **Built; checked in DevTools.**
9. Essence trim → diff → editable result. **Done.**
10. Send as a draft. **Done.**
11. Send as a queued post. **Done, including Instagram personal profile (notification scheduling + image URL).**
12. Network guard: over-limit and unsupported channels refuse before Buffer. **Built; unit-checked, not exercised in the browser.**
13. Sign out: the endpoint clears the cookie, but no UI button calls it. **API only.**
14. Production: connect, read the queue, cut a test post, send a draft, reconnect. **Not run; not deployed.**

## 13. Known limitations

- **No Merge**, as agreed for v1.
- **No queue audit and no AI reasons.** The two deterministic reasons are `error` status and a `dueAt` in the past.
- **No ideas.** They are neither read nor created.
- **No organization picker.** The first organization is selected automatically.
- **No sign-out in the UI**, although `/api/auth/logout` works.
- Cookie sessions cannot coordinate concurrent refreshes across tabs. Acceptable for v1; documented.
- Queue is a load-time snapshot and only the first page (up to 50, reviewed as 20). Another device's changes appear on refresh.
- **Cut has no undo.** It deletes immediately once Buffer confirms; the demo should use a test account.
- Media-only posts are kept and labelled "Image post" or "Video post", with a thumbnail.
- Character limits are known for the common networks; an unknown service falls back to 4,000 characters. Buffer remains the final judge.
- TikTok, YouTube and Pinterest creation is blocked with a reason: this version sends text and images, not video or boards.
- Instagram personal profiles are scheduled as reminders, not automatic publishing.
- Vercel's function rewrite path semantics are unconfirmed on a live deployment.
- The production redirect URI is not registered yet and the production domain is unknown. Local OAuth works with `https://localhost:5173/api/auth/callback`.

## 14. Deployment runbook

Prepared in `docs/DEPLOY.md`; **not executed**.

1. Create a Vercel project from the GitHub repo. Framework preset: Vite. Build `npm run build`; output `dist` (also set in `vercel.json`).
2. Set environment variables in Vercel:
   - `BUFFER_CLIENT_ID`
   - `BUFFER_CLIENT_SECRET`
   - `REDIRECT_URI=https://<production-domain>/api/auth/callback`
   - `SESSION_SECRET` (fresh, `openssl rand -hex 32`)
   - `AI_API_KEY` (when the provider is chosen)
3. Register the production redirect URI on the Buffer app client, character for character. Keep the localhost URI registered too.
4. Deploy. Confirm `vercel.json` routes `/api/*` to the function and static files are served.
5. Smoke test on production: connect, load the queue, keep through a card, cut a **test** post, confirm it is gone in Buffer, call `POST /api/auth/logout` (there is no UI button yet), reconnect.
6. Do not use a preview deployment for OAuth unless its redirect URI is registered and `REDIRECT_URI` is set for it; cookies cannot cross hosts.

## 15. Decision log

| # | Decision | Why |
|---|---|---|
| D1 | One Express function at `/api` | Matches the Buffer starter, shared session code, fewer cold starts. |
| D2 | Server JS ESM, client TS | Port the starter with minimal risk; keep UI contracts typed. |
| D3 | No router | Four screens, one flow; OAuth always returns to `/`. |
| D4 | AI returns text, client diffs | The UI can only mark cuts that actually happened. |
| D5 | Drop Merge from v1 | Removes the only two-call mutation and one decision per card is calmer. |
| D6 | Cut deletes immediately, no undo | Honest and simple; label it and demo on a test account. |
| D7 | Ideas are create-only | Buffer has no update/delete idea mutation. |
| D8 | Deterministic audit fallback | The app still works if AI fails; demo stays reliable. |
| D9 | Sort the queue in JavaScript | The `SortDirection` enum spelling is unverified; sorting normalized posts is safe and testable. |
| D10 | Fixtures behind `DEV && ?demo=1` | Design and motion can be built without a Buffer session; production builds drop the path. |
| D11 | Select the first organization automatically | One organization keeps v1 small; a picker is deferred. |
| D12 | Request only the scopes a slice uses | The read path shipped first; `posts:write` was added with Cut and needs one re-consent. |
| D13 | Derive card reasons on the client | Status and due date are already in the queue payload; no server reason field yet. |
| D14 | Fetch queue then channels sequentially | Both calls share one session; parallel refreshes could rotate the refresh token twice. |
| D15 | Delete first, dissolve second | The card only leaves after Buffer confirms, so a failed Cut cannot look like a success. |
| D16 | No queue re-fetch before Cut | The session already authorizes the user's own post; Buffer rejects anything else. One fewer call keeps the strike immediate. |
| D17 | Require a same-origin `Origin` on mutations | Cheap, explicit CSRF defence that does not depend on `SameSite` alone. |

## 16. Open technical questions

1. AI provider and model (one `complete()` seam).
2. Does `deletePost` succeed for `error` status posts?
3. Vercel rewrite: confirm `/api/(.*)` → `/api` preserves the Express path.
4. Production domain and the exact registered redirect URIs.
5. Review set: keep reviewing **all** posts (current code) or restore flagged-only from the PRD? This needs a product decision before the audit is built.
6. Pagination: is the first 50 enough, or should the client follow `pageInfo` before capping at 20?
7. Where should sign-out live now that `/api/auth/logout` exists but nothing calls it?
