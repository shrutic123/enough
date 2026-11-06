# Enough

> A calm way to cut your Buffer queue down to what you actually mean to say.

Built for **Buffer Commit 2026**. Connects to your Buffer account with OAuth and works on your real queue and ideas.

**Live app:** [TODO: https://your-app.vercel.app]
**Demo video (2-3 min):** [TODO: link]
**Write-up:** [TODO: link or see below]

![Enough: cutting a post from the queue](docs/screenshot-cut.png)

---

## The problem

People who post every day end up with a queue full of near-duplicates, stale ideas and drafts padded with filler. [TODO: 2-3 sentences in your own voice. Who is this for, and what was the moment that made you build it?]

## What it does

1. **Queue declutter.** Pulls your scheduled posts and ideas from Buffer. AI flags duplicates, stale items and over-posting, then you decide: Keep, Merge or Cut, one card at a time.
2. **Essence editor.** Paste a draft and AI trims it to one idea. You see exactly which words were cut, then send the result to Buffer as a scheduled post, draft or idea.

[TODO: add a short GIF of each flow]

## Built during the contest window

Contest window: **Oct 28 - Nov 13, 2026.** This repository was created on [TODO: date] and everything in it was written inside the window.

| Area | Status |
|---|---|
| OAuth 2.0 + PKCE flow, token refresh, session handling | Adapted from Buffer's `app-client-starter-app` (see Credits) |
| Queue declutter (fetch, AI audit, Keep/Merge/Cut) | New in this window |
| Essence editor (AI trim, word-level diff, create in Buffer) | New in this window |
| Visual identity and motion (`enough.css`) | New in this window |

Commit history shows the day-by-day build. See [BUILD_LOG.md](BUILD_LOG.md).

## How it uses the Buffer API

Authentication: OAuth 2.0 Authorization Code flow with PKCE, with `offline_access` for refresh tokens.

Scopes requested: [TODO: list only what you actually use, e.g. `account:read`, `posts:read`, `posts:write`, `ideas:read`, `ideas:write`]

| Feature | GraphQL operation | File |
|---|---|---|
| List channels | [TODO: query name] | `api/_lib/buffer.ts` |
| Read scheduled posts | [TODO] | `api/buffer/queue.ts` |
| Read ideas | [TODO] | `api/buffer/ideas.ts` |
| Create post / draft / idea | [TODO] | `api/buffer/create.ts` |
| [TODO: delete or update, if supported] | [TODO] | [TODO] |

## Run it locally

Requirements: Node [TODO: version], a Buffer account, an AI provider key.

```bash
git clone [TODO: repo url]
cd enough
cp .env.example .env      # fill in the values
npm install
npm run dev
```

Buffer requires **HTTPS redirect URIs, even on localhost**. [TODO: document how you did it, e.g. a local certificate via mkcert or the dev command you used.]

1. In Buffer, open Settings > API > App Clients and create a client.
2. Add `https://localhost:[PORT]/api/auth/callback` as a redirect URI (and your production one).
3. Put the client ID and secret in `.env`.

## Deploy

[TODO: Vercel steps. Set the same env vars in the host, generate a fresh `SESSION_SECRET`, register the production redirect URI, then smoke test: connect, create something, sign out, reconnect.]

## Architecture

```
Browser (React) --> /api (server functions) --> Buffer GraphQL API
                                           \--> AI provider
```

- Tokens live server-side in an encrypted, HttpOnly session cookie. They never reach the browser.
- The AI key is server-side only.
- [TODO: one line on rate limits / caching of channels and organization IDs]

## AI and your data

- What is sent to the AI provider: [TODO: e.g. post text only, nothing else]
- What is stored: [TODO: e.g. nothing beyond the session cookie]
- Model: [TODO]

## Design notes

Enough looks like an editor's desk. The blue pencil is the only accent, and it only ever marks a cut. Motion answers an action, and the one unprompted moment is the "Enough." end screen. Reduced-motion users get fades instead. [TODO: anything you tried and dropped]

## Known limits

- [TODO: honest list, e.g. channels or post types not covered, API actions not available]

## Credits

- Starter OAuth structure adapted from Buffer's [`buffer-sample-apps`](https://github.com/bufferapp/buffer-sample-apps) (`app-client-starter-app`).
- Fonts: Instrument Sans and Instrument Serif (Google Fonts).

## License

[TODO: MIT is a common choice]
