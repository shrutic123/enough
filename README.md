# Enough

> Restraint is not the opposite of creativity; it is what makes creativity legible.

Built for **Buffer Commit 2026**. Connects to Buffer with OAuth and works on the real queue: keep or cut each post, then trim a draft to one idea and send it back.

**Live app:** <https://enough-nu-flame.vercel.app>
**Demo video:** [recording runbook](docs/DEMO_VIDEO.md). Add the published link here after the first live run.

---

## The problem

A queue is an inventory, and inventories grow. Posts that made sense three weeks ago, two drafts saying the same thing, an error that never sent. Buffer shows all of it and asks you to manage it. Decluttering needs a decision, not another dashboard.

Enough is an editor's desk. One card at a time, one decision: keep it or cut it. When the queue is clear, it says **Enough.**

## What it does

1. **Queue.** Reads scheduled posts, drafts, errors and posts awaiting approval. Shows one card with its network, account, date, a thumbnail when the post has media, and a plain-language reason when there is one. **K** keeps, **C** cuts. Cut deletes the post in Buffer; a failure keeps the card and says so.
2. **Essence editor.** Paste a draft and press **Trim**. The server returns a shorter version; the browser computes the word-level diff, draws the blue pencil through the removed words and collapses them. The result stays editable; choose a channel and a destination, then send it to Buffer as a queued post or a draft. Instagram needs an image, so the editor asks for an optional public image URL when that channel is selected. If the draft is already tight, it says so instead of playing an empty animation.

There is no Merge, no ideas manager, and no AI audit in this release. Keep/Cut is the whole review, because one decision per card is the point.

## Built during the contest window

Contest window: **Oct 28 – Nov 13, 2026.** Everything below was written inside it.

| Area | Status |
|---|---|
| OAuth 2.0 + PKCE, refresh-token rotation, sealed session cookie | Adapted from Buffer's `app-client-starter-app`, then changed for this app |
| Queue read, one-card review, Keep/Cut motion, real `deletePost` | New in this window |
| Essence editor, AI trim, word-level diff, `createPost` as queue or draft | New in this window |
| Visual identity and motion (`enough.css`) | Pre-existing tokens, extended in this window |

Commit history and [BUILD_LOG.md](BUILD_LOG.md) show the order of work.

## How it uses the Buffer API

OAuth 2.0 Authorization Code with PKCE, `prompt=consent`, refresh tokens via `offline_access`. Tokens live only in an encrypted, HttpOnly cookie.

Scopes requested: `account:read`, `posts:read`, `posts:write`, `offline_access`.

| Feature | GraphQL operation | File |
|---|---|---|
| Account and organizations | `account` | `server/buffer.js` |
| Channels | `channels` | `server/buffer.js` |
| Queue | `posts` (statuses `scheduled`, `draft`, `error`, `needs_approval`) | `server/buffer.js` |
| Cut | `deletePost` | `server/buffer.js`, `server/app.js` |
| Create queue post or draft | `createPost` | `server/buffer.js`, `server/app.js` |

The queue is sorted by `dueAt` in JavaScript with missing dates last; only the first 50 posts are read, and the review is capped at 20 cards.

## Run it locally

Requirements: Node 22, npm, a Buffer account, and one AI provider key.

```bash
git clone https://github.com/shrutic123/enough.git
cd enough
cp .env.example .env
npm install
npm run dev
```

Fill `.env` with the Buffer client ID and secret, and one of `GEMINI_API_KEY`, `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`.

Buffer requires **HTTPS redirect URIs even on localhost**, and compares them character for character. Vite serves HTTPS locally through `@vitejs/plugin-basic-ssl`.

1. In Buffer, open **Settings → API** and create or edit the app client.
2. Enable `account:read`, `posts:read`, `posts:write` and `offline_access`.
3. Register `https://localhost:5173/api/auth/callback` (and your production callback later).
4. Put the client ID and secret in `.env`.

Open `https://localhost:5173`, accept the self-signed certificate, and click **Connect Buffer**.

## Deploy

See [docs/DEPLOY.md](docs/DEPLOY.md) for the Vercel runbook: environment variables, the production redirect URI, and the smoke test.

## Architecture

```
Browser (React + Vite)
  │ same-origin fetch, no tokens
  ▼
/api  (one Express app)
  ├─ /api/auth/*     OAuth, PKCE, session
  ├─ /api/buffer/*   account, channels, queue, cut, create
  └─ /api/ai/essence trim
  │
  ├──► Buffer GraphQL  https://api.buffer.com
  ├──► Buffer OAuth    https://auth.buffer.com
  └──► AI provider
```

- The server is plain JavaScript ESM; the client is TypeScript.
- One Express function at `/api` locally and on Vercel.
- A failed Cut never removes the card. The card only leaves after Buffer confirms the delete.
- The browser never sees a Buffer token or the AI key.

More detail: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## AI and your data

- **Trim:** only the draft text is sent. No account id, email, channel name or queue data.
- **Queue:** no post text is sent to an AI provider in this release. Reasons come from status and date.
- **Stored:** nothing beyond the session cookie. Drafts are not saved on the server.
- **Provider:** whichever key is set, in order: Gemini (`gemini-3.5-flash-lite`), OpenAI (`gpt-4.1-mini`), Anthropic (`claude-sonnet-4-5`). `AI_MODEL` overrides the model. Each Gemini attempt is capped at 12 seconds and falls back once to `gemini-3.5-flash`, so a slow model cannot turn a trim into a timeout. No billing is needed: the free tier allows about 500 Lite requests a day, versus 20 on Flash.
- The trim prompt forbids adding facts, links, hashtags, emoji or new sentences, and asks for the text only. The client computes the diff, so a mark can only appear on a word the model actually dropped.

## Design notes

One 640px column, left-aligned. Instrument Sans everywhere; Instrument Serif italic only for "Enough." The blue pencil `#2F4BFF` is the only accent and only ever marks a cut or holds focus. Actions are text with key hints, not buttons in boxes.

Motion answers an action: the pencil draws (220ms), a confirmed cut crumples the sheet as paper on a canvas (650ms) with a quiet synthesized rustle, then the gap collapses (280ms). Keep has its own quieter beat: the sheet lifts, slides back under the pile and a graphite "kept" note appears in the margin. The one unprompted moment is the end screen, where "Enough." settles once. With `prefers-reduced-motion`, those become 120ms fades with no transforms and no stagger. Sound has a header toggle, and the choice is remembered locally.

Dropped on purpose: Merge, because it is two calls with a partial-failure state; an AI queue audit, because deterministic reasons were enough and the model was not allowed to make the decision; idea creation, because ideas cannot be updated or deleted and cannot join Keep/Cut.

## Known limits

- Cut is permanent. There is no undo; use a test account for demos.
- The first organization on the account is used. There is no organization or channel switcher.
- One page of the queue (50 posts) and at most 20 review cards.
- Media-only posts show as "Image post" or "Video post" with a thumbnail. Only a post with neither text nor media is hidden.
- Ideas are not shown or created.
- The queue is a snapshot taken on load. Another device's changes appear on refresh.
- Channel limits are checked before sending for X, Bluesky, Threads, Mastodon, LinkedIn, Instagram, Facebook and Google Business. Buffer is still the final judge. TikTok, YouTube and Pinterest creation is blocked with a reason, because this version sends text and images only.
- If Buffer has no posting slots on a channel, "Add to queue" is refused by Buffer; save as a draft instead.

## Credits

- OAuth, refresh and `createPost` shapes adapted from Buffer's [`buffer-sample-apps`](https://github.com/bufferapp/buffer-sample-apps) (`app-client-starter-app`).
- Fonts: Instrument Sans and Instrument Serif (Google Fonts).

## License

MIT.
