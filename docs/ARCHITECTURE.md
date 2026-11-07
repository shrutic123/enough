# Enough — Technical Architecture

**Status:** living draft, v0.2, Nov 6 2026.
**Source of truth:** the code. This document is reconciled to commit `73618bb`; update it after each session.
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
   └─ /api/ai/*       AI calls, provider key server-side [planned]
   │
   ├──► Buffer GraphQL  https://api.buffer.com           [built]
   ├──► Buffer OAuth    https://auth.buffer.com/auth, /token  [built]
   └──► AI provider                                      [planned]
```

Two hosting modes, one server codebase:

- **Local [built]:** Vite dev server on `https://localhost:5173`, Express on `http://localhost:3001`, Vite proxies `/api` to Express. One browser origin, so the session cookie and the OAuth callback share a host.
- **Production [built but unverified]:** Vercel serves the Vite build as static files and runs the same Express app as one serverless function at `/api`. The rewrite has not been exercised on a live deployment.

## 2. Repository layout

```text
enough/
  api/index.js                  Vercel entry: re-exports server/app.js; never listens
  server/
    app.js                      Express app: session middleware, six routes, error handler
    index.js                    local listener only (Node --watch)
    config.js                   env loading, redirect URI, host guard, scopes, session secret
    session.js                  iron-session wrapper
    buffer.js                   PKCE, token exchange/refresh, GraphQL client, queries
  src/
    main.tsx                    React entry
    App.tsx                     session load, dev demo bypass, Connect vs Queue
    types.ts                    client/server contract
    lib/api.ts                  typed fetch helpers (session, channels, queue, logout)
    lib/format.ts               date, subline, counts
    pages/Connect.tsx           connect screen
    pages/Queue.tsx             review session and motion state machine
    pages/End.tsx               end screen
    pages/Essence.tsx           placeholder only, not imported by App
    components/QueueCard.tsx    one card, Keep/Cut
    hooks/useReducedMotion.ts   matchMedia listener
    fixtures/cards.ts           dev-only demo cards
    styles/app.css              Tailwind directives + small app rules
  enough.css                    design tokens and motion (pre-existing)
  tailwind.config.js            tokens mapped to CSS vars (pre-existing)
  docs/                         PRD, architecture, deploy notes
  vercel.json                   build/output + /api rewrite
  .env.example                  placeholders only
```

There is no `server/ai.js`, no `src/lib/diff.ts`, and no Card/ActionBar/WordDiff/EnoughMark component tree yet.

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

### Flow **[built, not browser-tested]**

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

### Redirect URI **[built config, not registered]**

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
| `offline_access` | **requested** | refresh token |
| `posts:write` | planned | Cut, edit, create |
| `ideas:read` | planned | Essence → idea destination |
| `ideas:write` | planned | create an idea |

`SCOPES` is exactly `account:read posts:read offline_access`. Adding write scopes requires enabling them on the app client and re-consenting.

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
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}
```

- **No `sort` argument.** The `SortDirection` spelling is unverified, so `normalizeQueue()` sorts by `dueAt` in JavaScript: ascending, with missing/unparseable dates last.
- `first` comes from `?first=`, default 50, clamped to 1..50. The client does not send it, so the server fetches 50. `after` is declared but never sent: only the first page is read.
- Each post is joined server-side to the channel list: `channelName = displayName || name || ''`, plus `service`.
- Posts with missing or blank `text` (media-only) are skipped.
- Status is lowercased into the `PostStatus` union.
- The client sorts again by `dueAt` (nulls last) and caps the review at 20 cards.

### Cut **[planned]**

```graphql
mutation DeletePost($input: DeletePostInput!) {
  deletePost(input: $input) {
    ... on DeletePostSuccess { id }
    ... on MutationError { message }
  }
}
```

`DeletePostInput` is `{ id: PostId! }`. Only allow ids that were in the fetched queue; do not accept arbitrary ids from the browser. The client currently cuts locally and never calls this.

### Create **[planned]**

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

- Required: `channelId`, `text`, `assets: []`, `needsApproval: false`, `mode`, `schedulingType: automatic`.
- `saveToDraft: true` requires a channel and makes the status `draft`.
- Per-network metadata is required for some services (Instagram `{type:"post", shouldShareToFeed:true}`, Facebook `{type:"post"}`, Google Business `{type:"whats_new"}`). Reuse the starter's `buildPostInput` mapping. YouTube needs a title.
- `mode`: `addToQueue` for the default; `customScheduled` + `dueAt` if a time is chosen.

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
| GET | `/api/buffer/channels` | `organizationId` (required) | `{ channels }` | **built** |
| GET | `/api/buffer/queue` | `organizationId` (required), `first?` | `{ posts: QueueCard[] }` | **built** |
| POST | `/api/buffer/cut` | `{ postId }` | `{ ok: true }` | planned |
| POST | `/api/buffer/create` | `{ kind, text, channelId?, mode?, dueAt?, title? }` | `{ post?, idea? }` | planned |
| POST | `/api/ai/essence` | `{ text }` | `{ trimmed }` | planned |
| POST | `/api/ai/audit` | `{ posts: [{id,text,channel,dueAt,status}] }` | `{ duplicates, stale, overPosting }` | planned |

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
}
```

`/api/buffer/session` echoes `redirectUri` on purpose: curl it to see the exact string the server will send, instead of guessing from Buffer's generic error page.

## 7. Client architecture

- No router **[built]**. `App.tsx` loads the session once, then renders `Connect` or `Queue`. `Queue` owns the review and renders `End` when the cards run out. `Essence` is a placeholder and is not imported.
- `Queue.tsx` holds the whole review session in local state: load status, the capped card list, index, done, kept/cut totals, the motion phase and visual flags, and the live-region message. There is no store and no `useQueue` hook.
- The first organization on the account is selected automatically (`session.account.organizations[0]`). There is no organization or channel picker UI; `getChannels()` exists in `lib/api.ts` but is unused.
- Read state is fetched, not duplicated. The queue is a snapshot taken on load; a refresh re-reads Buffer.
- No mutation is wired. Keep makes no API call; Cut only changes local state, so a refresh brings the cut post back.
- Errors render in place with a Try again action, not as alerts. A failed queue load also offers Reconnect.
- `?demo=1` is a development-only fixture path. In `App.tsx`, `import.meta.env.DEV && ?demo=1` skips the session fetch and renders `QueuePage` with a fake session; `Queue.tsx` then loads `src/fixtures/cards.ts` instead of calling the API. `import.meta.env.DEV` is false in production builds, so the path cannot ship as a fake success.
- Reduced motion is read with `useReducedMotion()` (a `matchMedia` listener), not only by CSS.

## 8. AI layer **[planned]**

No AI code exists yet: there is no `server/ai.js`, no AI endpoint, and no provider key. The design below is the agreed shape for when it is built.

### Essence

- Server builds a strict prompt: "Return only the trimmed text. Keep one idea. Do not add facts, links, hashtags, emoji or calls to action. Preserve voice, @mentions and URLs. Do not explain."
- Send `{ text }` only. Cap input (e.g. 4,000 characters) and output.
- Validate: non-empty, no longer than the input, not an obvious refusal. On failure, return 502 with "The trim didn't come back. Your draft is unchanged."
- The **client** computes the word-level diff between original and trimmed text. This guarantees the pencil marks correspond to real deletions. No index-based model output.

### Audit

- One call per queue load, with at most 20 posts.
- Input fields only: `id`, `text`, `channel`, `dueAt`, `status`.
- Ask for JSON, then validate every id against the fetched set. Drop unknown ids silently.
- Deterministic fallback runs regardless, and is the sole source if the AI call fails:
  - stale: `dueAt < now` or `status === 'error'`
  - over-posting: count per channel in a rolling 7-day window
  - near-duplicate: normalize (lowercase, strip punctuation/URLs), token overlap above a threshold
- The model's output can reorder and explain, but cannot invent an item or trigger a delete.

### Provider

**[open]** The AI provider is not chosen. Keep a small `complete(prompt)` seam so the provider is one file. The key is server-side, never `VITE_`-prefixed.

## 9. Motion implementation

### Cut **[built, local only]**

`Queue.tsx` runs a four-phase machine: `idle → striking → leaving → collapsing → idle`.

1. **Strike** (`striking`): add `.on` to `.struck`; the pencil line draws for **220ms**.
2. **Leave** (`leaving`): after 220ms, add `.is-gone` to the card; the dissolve runs **320ms**. A `400ms` timer is a safety net if `animationend` never fires. `animationend` on the card itself also calls the collapse step.
3. **Collapse** (`collapsing`): add `.collapsed` to the wrapping `.slot` (grid row `1fr → 0fr`, **280ms**).
4. **Advance**: after 280ms, clear timers, increment the cut total, announce "Cut. N left.", reset the visual flags, advance the index, and move focus to the next card's Keep button.

Reduced motion: strike wait 0ms, dissolve fallback 160ms (CSS animations run at 120ms), collapse wait 0ms. Focus and the announcement still happen.

### Keep **[built]**

`idle → leaving` directly: add `.is-kept` (slide right, **180ms**), then collapse the slot (**280ms**), then advance. Reduced motion waits 120ms for the fade, then collapses immediately. Keep makes no API call and counts toward "kept".

### Guards and accessibility **[built]**

- `phaseRef` and `indexRef` reject a second decision while a phase is running; repeated keydowns are ignored.
- `K` / `C` are ignored when the event has modifiers, repeats, comes from an input/textarea/select/contentEditable, or the screen is loading/done.
- Each card is an `<article>` with real `<button>` actions; the `K`/`C` hints are `<kbd aria-hidden="true">`.
- The Keep button is ref-forwarded; after advance, an effect focuses the next card's Keep button.
- A visually hidden `aria-live="polite"` region announces "Kept. N left." or "Cut. N left."
- The card carries `aria-busy` while a phase runs.
- `useReducedMotion()` feeds the JS timers; `enough.css` also reduces all animations to 120ms and transitions to 1ms.

### Essence **[planned]**

- Render each word as `<span class="word" style={{'--i': n}}>`.
- Removed words get `.cut` (pencil line drawn) and then `.gone`; the CSS delays the collapse by `220ms + i*25ms`.
- The visible word count is derived from the trimmed text, not a separate counter; update it at the end of the stagger unless there is time for a tween. **[open]**
- The `.word` CSS exists and is unused until the editor ships.

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
- The browser never sends a Buffer token. It does send `organizationId`, which the server passes through without independently checking membership. Mutations must validate ids server-side when built. **[built read path / planned mutation path]**
- CSRF: the OAuth callback is a top-level GET protected by `state`. `SameSite=Lax` blocks cross-site form posts. There is no explicit Origin check on future mutations. **[open]**
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

Manual checks, with what is possible today:

1. Local connect → consent → back → queue loads. **[blocked until the localhost redirect URI is registered and `account:read` / `posts:read` are enabled]**
2. Queue returns real posts, sorted by `dueAt`, at most 20 cards. **[needs a session]**
3. Keep makes no API call and advances. **[built]**
4. Cut animates and removes the card locally; a refresh restores it. **[built; deletePost is not wired]**
5. End screen shows "Enough." with kept/cut totals and receives focus. **[built]**
6. `?demo=1` in `npm run dev` shows the fixture cards with no session. **[built]**
7. Reduced motion: no strike wait or slide, state still updates. **[built]**
8. Sign out: the endpoint clears the cookie, but no UI button calls it. **[API only]**
9. Production: connect, read the queue, sign out, reconnect. **[not run; not deployed]**

## 13. Known limitations

- **Cut is local only.** No `deletePost` call; a reload restores cut posts. The PRD's destructive-cut behaviour is not implemented.
- **No AI.** No Essence, no queue audit, no duplicate or over-posting reasons. Only two deterministic reasons exist, both client-side: `error` status and a `dueAt` in the past.
- **No Merge**, as agreed for v1.
- **No Essence editor.** `pages/Essence.tsx` is a placeholder, not routed.
- **No organization or channel picker.** The first organization is selected automatically; the channels endpoint is unused by the UI.
- **No sign-out in the UI**, although `/api/auth/logout` works.
- Ideas are create-only; they cannot appear in Keep/Cut.
- Cookie sessions cannot coordinate concurrent refreshes across tabs. Acceptable for v1; documented.
- Queue is a load-time snapshot and only the first page (up to 50, reviewed as 20). Another device's changes appear on refresh.
- No undo for Cut once it is wired; deleting is permanent.
- Media-only posts are skipped.
- Vercel's function rewrite path semantics are unconfirmed on a live deployment.
- The localhost and production redirect URIs are not registered yet, so no browser OAuth round trip has been completed.
- Production domain is unknown.

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
5. Smoke test on production: connect, load the queue, keep/cut through the cards, call `POST /api/auth/logout` (there is no UI button yet), reconnect. Cut does not delete yet, so do not use a real queue to prove deletion.
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
| D12 | Request only read scopes now | The read path ships first; write scopes wait for mutations and a re-consent. |
| D13 | Derive card reasons on the client | Status and due date are already in the queue payload; no server reason field yet. |
| D14 | Fetch queue then channels sequentially | Both calls share one session; parallel refreshes could rotate the refresh token twice. |

## 16. Open technical questions

1. AI provider and model (one `complete()` seam).
2. Does `deletePost` succeed for `error` status posts?
3. Vercel rewrite: confirm `/api/(.*)` → `/api` preserves the Express path.
4. Production domain and the exact registered redirect URIs.
5. Whether to add an explicit Origin check on mutations.
6. Review set: keep reviewing **all** posts (current code) or restore flagged-only from the PRD? This needs a product decision before the audit is built.
7. Pagination: is the first 50 enough, or should the client follow `pageInfo` before capping at 20?
8. Where should sign-out live now that `/api/auth/logout` exists but nothing calls it?
