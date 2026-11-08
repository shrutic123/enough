# Deploy

Enough runs as a Vite static build plus one Vercel function. The client is
served from `dist/`; `/api/*` is the Express app in `server/app.js`, exported
through `api/index.js`.

Live: <https://enough-nu-flame.vercel.app>. The production callback is
registered and the OAuth round trip is verified. This document remains the
runbook for a fresh environment.

## Before deploying: the Buffer app client

In Buffer, open **Settings → API** and create (or edit) the app client.

1. Enable **`account:read`**, **`posts:read`**, **`posts:write`**, and
   **`offline_access`**. `posts:write` is what lets Cut delete a post;
   `offline_access` is required for refresh tokens.
2. Register both redirect URIs, character for character:
   - Local: `https://localhost:5173/api/auth/callback`
   - Production: `https://<your-domain>/api/auth/callback`

   `localhost` and `127.0.0.1` are different hosts for cookies, so use
   `localhost` locally.
3. Copy the client ID and secret. The secret is only for the server; never put
   it in the Vite client or commit it.

## Create the Vercel project

1. Import the repository into Vercel.
2. Root directory: the repository root.
3. Framework preset: Vite. `vercel.json` sets `buildCommand` to `npm run build`
   and `outputDirectory` to `dist`, so those values win even if the preset
   differs.
4. Add the environment variables:

   | Variable | Value |
   |---|---|
   | `BUFFER_CLIENT_ID` | The app client ID. |
   | `BUFFER_CLIENT_SECRET` | The app client secret (omit for a public client). |
   | `REDIRECT_URI` | `https://<your-domain>/api/auth/callback` |
   | `SESSION_SECRET` | Output of `openssl rand -hex 32` (32+ characters). |
   | `GEMINI_API_KEY` | One AI provider key. `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` also work, in that fallback order. |
   | `AI_MODEL` | Optional. Overrides the provider's default model. |

   Without an AI key the queue still works; only Trim returns "Trimming isn't available right now."

   `REDIRECT_URI` must be the exact production callback, including the
   `/api/auth/callback` path. If you leave it unset, the server derives it from
   `VERCEL_PROJECT_PRODUCTION_URL` on the production deployment only; preview
   deployments disable login.

   `SESSION_SECRET` is required in production. The server refuses to start
   without a value of at least 32 characters.

5. Deploy.

Vercel sets `NODE_ENV=production`, so the server does not read `.env` there.

## Register the production callback

After the first deployment, confirm the production domain, then add
`https://<your-domain>/api/auth/callback` to the Buffer app client's redirect
URIs. Buffer compares the string exactly, so a trailing slash or a different
subdomain will fail the token exchange.

## Smoke test

1. Open the production URL and click **Connect**.
2. Approve the listed scopes on Buffer. You should land back on `/` and see
   the queue for the first organization on the account.
3. Reload the page; the connection should survive (the sealed session cookie).
4. Cut one **test** post and confirm it is gone in Buffer. A failed Cut keeps
   the card and shows the error in place.
5. Open **Trim a draft**, paste a short draft, press **Trim**, and confirm the
   diff draws and the result can be saved as a draft. This checks the AI key and
   `createPost` together.
6. `curl -s https://<your-domain>/api/buffer/session` with the session cookie
   should show `connected: true` and the same `redirectUri` registered above.

If the callback fails, check the error query string on `/?error=...` and the
`redirect_uri` echoed by `/api/buffer/session`; they must match Buffer's
registered URI exactly.

## Local development

```bash
npm run dev
```

This starts Express on `http://localhost:3001` and Vite on
`https://localhost:5173`; Vite proxies `/api` to Express. Use
`https://localhost:5173/api/auth/callback` as the local redirect URI. Accept
Vite's self-signed certificate in the browser before clicking Connect.

The local callback depends on the proxy preserving the browser's `Host`
(`changeOrigin: false` in `vite.config.ts`). The server only starts login when
the request host matches the redirect URI host.

## Vercel routing note

`vercel.json` uses the documented Express-on-Vercel rewrite:

```json
{ "source": "/api/(.*)", "destination": "/api" }
```

Vercel gives the filesystem priority, so `dist/` assets are served normally and
only `/api/*` reaches the function. The rewrite preserves the original
`/api/...` path for Express, which the Buffer starter relies on.

This was exercised against a live anonymous Vercel deployment on Nov 7, 2026:

- `/` returned the built app and its hashed `assets/…` files.
- `/api/buffer/session` returned `{ "connected": false, "redirectUri": "…" }`,
  not a 404, so nested paths reach Express intact.
- `/api/auth/login` returned a `302` to Buffer with the production callback and
  the four scopes.

If a future deployment breaks nested routing, check that the Functions list
shows `api/index.js`; the fix is a catch-all function file (for example
`api/[...path].js`) that imports the same app, not a change to the Express
routes.

`.vercelignore` keeps `.env`, `.session-key` and local certificates out of the
upload even when they exist in the working tree. Vercel sets
`NODE_ENV=production`, so `server/config.js` never reads `.env` there.
