# Enough — Technical Architecture

**Status:** living draft, v0.1, Nov 6 2026.
**Source of truth:** the code. This document was seeded from the plan and verified Buffer docs; it is reconciled after each session.
**Related:** [PRD](PRD.md), [BUILD_LOG](../BUILD_LOG.md), [README](../README.md).

Legend: **[built]** exists in the repo, **[planned]** agreed but not built, **[open]** needs a decision or verification.

---

## 1. System overview

```
Browser (React + Vite)
   │  same-origin fetch, no tokens
   ▼
/api  (one Express app)
   ├─ /api/auth/*     OAuth 2.0 + PKCE, session cookie
   ├─ /api/buffer/*   GraphQL proxy, queue reads and mutations
   └─ /api/ai/*       AI calls, provider key server-side
   │
   ├──► Buffer GraphQL  https://api.buffer.com
   ├──► Buffer OAuth    https://auth.buffer.com/auth, /token
   └──► AI provider
```

Two hosting modes, one server codebase:

- **Local:** Vite dev server on `https://localhost:5173`, Express on `http://localhost:3001`, Vite proxies `/api` to Express. One browser origin, so the session cookie and the OAuth callback share a host.
- **Production:** Vercel serves the Vite build as static files and runs the same Express app as one serverless function at `/api`.

## 2. Repository layout

```text
enough/
  api/index.js            Vercel entry point; re-exports server/app.js
  server/
    app.js                Express routes and error handling
    index.js              local HTTP listener (Vite proxies to it)
    config.js             env, redirect URI, scopes, session secret
    session.js            iron-session wrapper
    buffer.js             PKCE, token exchange/refresh, GraphQL client, queries
    ai.js                 provider call + prompt + response validation
  src/
    main.tsx              React entry; imports Tailwind then enough.css
    App.tsx               session load + screen state
    types.ts              client/server contract
    lib/api.ts            typed fetch helpers
    lib/diff.ts           word-level diff (client)
    pages/                Connect, Queue, Essence, End
    components/           Card, ActionBar, WordDiff, EnoughMark
    styles/app.css        Tailwind directives + small app rules
  enough.css              design tokens and motion (already exists)
  tailwind.config.js      tokens mapped to CSS vars (already exists)
  docs/                   PRD, architecture, deploy notes
  vercel.json             API rewrite; static build
  .env.example            placeholders only
```

**Decision:** one Express function at `/api`, not eight separate serverless files. Rationale: the Buffer starter app already has this shape, the OAuth/session code is shared, and there are fewer cold starts. The README maps features to files instead of relying on a one-function-per-endpoint tree.

**Decision:** server in plain JavaScript ESM (ported from the Buffer starter, lower risk); client in TypeScript (the UI has real state and motion).

## 3. Local development

| Piece | Value |
|---|---|
| Browser origin | `https://localhost:5173` |
| Vite dev server | 5173, HTTPS via `@vitejs/plugin-basic-ssl`, `strictPort: true` |
| Express | `http://localhost:3001` |
| Vite proxy | `/api` → `http://localhost:3001`, **`changeOrigin: false`** |
| Redirect URI | `https://localhost:5173/api/auth/callback` |
| Scripts | `npm run dev` runs Express (`node --watch`) and Vite together |

`changeOrigin: false` matters: the server checks that the request host matches the redirect URI host, so the proxy must preserve `Host: localhost:5173`.

Buffer requires HTTPS even on localhost, and compares redirect URIs character for character. The localhost URI must be registered on the app client alongside the production URI.

## 4. Authentication

### Flow

1. `GET /api/auth/login`
   - Generate a PKCE verifier (32 random bytes, base64url) and a `state`.
   - Store both in the session; save the session before redirecting.
   - Redirect to `https://auth.buffer.com/auth` with `client_id`, `redirect_uri`, `response_type=code`, `scope`, `state`, `code_challenge`, `code_challenge_method=S256`, `prompt=consent`.
2. `GET /api/auth/callback`
   - Read `code`, `state`, `error` from the query.
   - Clear the one-time PKCE values from the session either way.
   - If `state` is missing or mismatched, return 403 with a plain explanation.
   - Exchange the code at `https://auth.buffer.com/token` with `client_secret` and `code_verifier`.
   - Save `{ accessToken, refreshToken, scope, expiresAt, connectedAt }` in the session; redirect to `/`.
3. `POST /api/auth/logout`
   - Destroy the session; return `{ connected: false }`.

### Session

- `iron-session` v9, cookie name `enough_session`.
- `httpOnly: true`, `secure: true`, `sameSite: 'lax'`, `path: '/'`, 30-day TTL.
- The cookie is encrypted with `SESSION_SECRET` (32+ chars). In development, if it is missing, generate `.session-key` (gitignored) so restarts do not invalidate a login. In production, fail loudly if it is missing.
- Tokens never leave the server. The client only sees `{ connected, account, redirectUri }`.

### Refresh

- Access tokens last about an hour (`expires_in`); store `expiresAt = now + expires_in - 30s`.
- Refresh tokens are single-use. Every successful refresh returns a replacement; save it before the next request.
- Reusing an old refresh token revokes the grant. Refresh in exactly one place: the GraphQL access-token helper.
- On 401 or a failed refresh: clear tokens, return 401, and the UI shows "Your Buffer session expired. Connect again."

### Scopes

Request only scopes enabled on the app client. Current plan:

| Scope | Used for |
|---|---|
| `account:read` | account, organizations, channels |
| `posts:read` | queue read |
| `posts:write` | Cut, edit, create |
| `ideas:read` | Essence → idea destination, if ideas are listed |
| `ideas:write` | create an idea |
| `offline_access` | refresh token |

Initial read-only slice: `account:read posts:read offline_access`. Add write scopes when the mutation endpoints ship, then re-consent.

## 5. Buffer GraphQL layer

- Endpoint: `https://api.buffer.com` (POST, JSON `{query, variables}`).
- Header: `Authorization: Bearer <access token>`.
- A GraphQL failure is usually HTTP 200 with an `errors` array; treat it as a failure and surface `extensions.code` plus `message`.
- A typed mutation failure is data, not an exception: `... on MutationError { message }` catches every error type.
- Rate limits: read `RateLimit` / `RateLimit-Policy`; on 429 read `Retry-After`. Retry once only if the wait is short (≤5s); otherwise surface the wait.
- Cache organization and channel data for the session; do not refetch on every screen.
- Never trust IDs, service names or post text from the browser. Re-fetch the queue/channel and validate before mutating.

### Verified operations

**Account**

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

**Channels**

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

`channels` returns a list (not a cursor connection). Filter out `isDisconnected` for destinations.

**Queue**

```graphql
query Queue($organizationId: OrganizationId!, $first: Int!, $after: String) {
  posts(
    first: $first
    after: $after
    input: {
      organizationId: $organizationId
      filter: { status: [scheduled, draft, error, needs_approval] }
      sort: [{ field: dueAt, direction: asc }]
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

- Page size and `SortDirection` values: **[open]** confirm in the explorer before shipping. The query shape above is from the reference; the sort enum spelling is the one unverified part.
- Normalize each node into a `QueueCard` and join the channel name/service from the cached channel list.
- Posts with an empty `text` (media-only) are skipped in v1.

**Cut**

```graphql
mutation DeletePost($input: DeletePostInput!) {
  deletePost(input: $input) {
    ... on DeletePostSuccess { id }
    ... on MutationError { message }
  }
}
```

`DeletePostInput` is `{ id: PostId! }`. `deletePost` returns `DeletePostSuccess | VoidMutationError`. Only allow ids that were in the fetched queue; do not accept arbitrary ids from the browser.

**Create**

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

**Idea**

```graphql
mutation CreateIdea($input: CreateIdeaInput!) {
  createIdea(input: $input) {
    ... on Idea { id content { title text } }
    ... on MutationError { message }
  }
}
```

`CreateIdeaInput`: `{ organizationId, content: { title, text } }`. **There is no update or delete idea mutation.** Ideas can only be created and read.

**Merge (planned, stretch)**

`editPost(input: { id, text })` → then `deletePost`. Only same-channel near-duplicates. If the edit succeeds and the delete fails, the user sees "The text was combined, but the duplicate wasn't deleted. Try again." Do not roll back by editing again.

## 6. Internal API surface

All responses are JSON. Errors use `{ "error": "sentence-case message" }` with the matching HTTP status.

| Method | Path | Body / query | Response |
|---|---|---|---|
| GET | `/api/auth/login` | — | 302 to Buffer |
| GET | `/api/auth/callback` | `code`, `state` | 302 to `/` or a plain error |
| POST | `/api/auth/logout` | — | `{ connected: false }` |
| GET | `/api/buffer/session` | — | `{ connected, account?, redirectUri }` |
| GET | `/api/buffer/channels` | `organizationId` | `{ channels }` |
| GET | `/api/buffer/queue` | `organizationId`, `first?` | `{ posts: QueueCard[] }` |
| POST | `/api/buffer/cut` | `{ postId }` | `{ ok: true }` **[planned]** |
| POST | `/api/buffer/create` | `{ kind, text, channelId?, mode?, dueAt?, title? }` | `{ post? , idea? }` **[planned]** |
| POST | `/api/ai/essence` | `{ text }` | `{ trimmed }` **[planned]** |
| POST | `/api/ai/audit` | `{ posts: [{id,text,channel,dueAt,status}] }` | `{ duplicates, stale, overPosting }` **[planned]** |

Client contract lives in `src/types.ts`:

```ts
type QueueCard = {
  id: string
  text: string
  channelId: string
  channelName: string
  service: string
  dueAt: string | null
  status: 'draft' | 'error' | 'needs_approval' | 'scheduled' | 'sending' | 'sent'
}
```

`/api/buffer/session` echoes `redirectUri` on purpose: curl it to see the exact string the server will send, instead of guessing from Buffer's generic error page.

## 7. Client architecture

- No router. `App.tsx` loads the session once, then renders `Connect` or `Queue`; `Queue` owns the review session and can hand off to `Essence` / `End`.
- Server state is fetched, not duplicated in a store. A small `useQueue` hook holds the current card, the remaining list and the counts.
- Mutations are explicit and optimistic only where it is safe: Cut removes the card locally **after** the server confirms, never before.
- The queue is a snapshot taken on load. After a Cut, the local list is the source of truth for the session; a refresh re-reads Buffer.
- Errors are rendered in place, not as alerts. A failed action keeps the card and its text intact.
- `demo=1` (development only) loads fixture cards so the motion and layout can be built without a Buffer session. It must never ship as a fake success path in production.

## 8. AI layer

### Essence

- Server builds a strict prompt: "Return only the trimmed text. Keep one idea. Do not add facts, links, hashtags, emoji or calls to action. Preserve voice, @mentions and URLs. Do not explain."
- Send `{ text }` only. Cap input (e.g. 4,000 characters) and output.
- Validate: non-empty, no longer than the input, and not an obvious refusal. If it fails, return 502 with "The trim didn't come back. Your draft is unchanged."
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

**[open]** The AI provider is not chosen yet. Keep `server/ai.js` behind a small `complete(prompt)` function so the provider is one file. The key is server-side, never `VITE_`-prefixed.

## 9. Motion implementation

### Cut

1. Add `.on` to the `.struck` span inside the card (the pencil line draws, 220ms).
2. Wait 220ms.
3. Add `.is-gone` to the card (dissolve 320ms).
4. On `animationend`: add `.collapsed` to the wrapping `.slot` (grid row `1fr → 0fr`, 280ms).
5. On `transitionend`: remove the card node, reset the slot, move focus to the next card's Keep button, announce the new count in a polite live region.

Reduced motion: skip 1–2; fade the card (120ms), collapse instantly, keep focus and the announcement.

### Keep

Add `.is-kept` (180ms slide right), then collapse the slot as above. Focus moves to the next card.

### Essence

- Render each word as `<span class="word" style={{'--i': n}}>`.
- Removed words get `.cut` (pencil line drawn) and then `.gone`; the CSS delays the collapse by `220ms + i*25ms`.
- The visible word count is derived from the trimmed text, not a separate counter; animate it with a short `requestAnimationFrame` loop or a CSS transition on a numeric value. Simpler: update the count at the end of the stagger. **[open]** choose the simpler version if time is tight.
- `.word` must not clip long words at rest; apply `max-width` only during the collapse.

### End

`.enough` uses the existing `settle` animation (900ms, letter-spacing tightens). The reduced-motion rule needs a dedicated fade-in keyframe instead of `animation-direction: reverse` (the current CSS is fragile).

### Known CSS fixes

- `.word.cut` currently shows the line instantly; add a `background-size` transition like `.struck`.
- `.word` has `max-width: 24ch` at rest, which can clip long words.
- The reduced-motion `.enough` override should be rewritten as a clean fade-in.

## 10. Security

- OAuth `state` is one-time and verified; the PKCE verifier never leaves the server.
- Session cookie is encrypted and HttpOnly; no tokens in client JS, `localStorage` or `sessionStorage`.
- `Cache-Control: no-store, private` on `/api/*` and auth routes.
- The browser never sends a Buffer token, organization id it chose, or arbitrary post id without server validation.
- CSRF: the OAuth callback is a top-level GET protected by `state`. Mutating JSON endpoints require same-origin `Content-Type: application/json` and the session cookie; `SameSite=Lax` blocks cross-site form posts. **[open]** add an explicit origin check on mutations if time permits.
- Rate limits are per app client and shared by all users; cache and back off.
- `.env` is gitignored; `.env.example` contains placeholders only. Never log tokens or full auth headers.

## 11. Observability and debugging

- Structured JSON logs for OAuth exchange failures, refresh failures, Buffer API errors and AI failures. Log the event, status and code — never the token or post text.
- `/api/buffer/session` echoes `redirectUri` to debug character-level mismatches.
- Buffer's explorer (`developers.buffer.com/explorer.html`) is the reference for field names; do not guess.
- The sample app (`bufferapp/buffer-sample-apps`, `samples/app-client-starter-app`) is the reference for OAuth, refresh, 429 handling and `createPost` required fields.

## 12. Verification

No automated test suite in v1. The smoke tests are:

1. `npm run typecheck` and `npm run build` pass.
2. Local: connect → consent → back → channels listed.
3. Queue returns real scheduled posts; refresh matches Buffer.
4. Cut a post → it disappears from Buffer.
5. Keep a post → Buffer is unchanged.
6. Essence: trim → marks match the diff → send → item appears in Buffer.
7. Sign out → session cookie gone → reconnect works.
8. Reduced motion: no transforms, no stagger, state still updates.
9. Production: repeat 2–7 on the deployed HTTPS URL with the production redirect URI.

## 13. Known limitations

- Ideas are create-only; they cannot appear in Keep/Cut.
- Merge is deferred; two calls with a partial-failure state.
- Cookie sessions cannot coordinate concurrent refreshes across tabs. Acceptable for v1; documented.
- Queue is a load-time snapshot; another device's changes appear on refresh.
- No undo for Cut; deleting is permanent. The UI says so.
- Media-only posts are skipped.
- Single organization assumed for the first release; the account's first organization is selected. Multi-org switcher is out of scope.
- Vercel's function rewrite path semantics must be confirmed on the first deploy.

## 14. Deployment runbook

1. Create a Vercel project from the GitHub repo. Framework preset: Vite. Build `npm run build`; output `dist`.
2. Set environment variables in Vercel:
   - `BUFFER_CLIENT_ID`
   - `BUFFER_CLIENT_SECRET`
   - `REDIRECT_URI=https://<production-domain>/api/auth/callback`
   - `SESSION_SECRET` (fresh, `openssl rand -hex 32`)
   - `AI_API_KEY` (when the provider is chosen)
3. Register the production redirect URI on the Buffer app client, character for character. Keep the localhost URI registered too.
4. Deploy. Confirm `vercel.json` routes `/api/*` to the function and static files are served.
5. Smoke test on production: connect, load queue, cut a test post, create a draft, sign out, reconnect.
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

## 16. Open technical questions

1. AI provider and model (one `complete()` seam).
2. `SortDirection` enum spelling and max page size for `posts`.
3. Does `deletePost` succeed for `error` status posts?
4. Vercel rewrite: confirm `/api/(.*)` → `/api` preserves the Express path.
5. Production domain and the exact registered redirect URIs.
6. Whether to add an explicit Origin check on mutations.
