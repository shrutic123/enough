# Deploy

Enough runs as a Vite static build plus one Vercel function. The client is
served from `dist/`; `/api/*` is the Express app in `server/app.js`, exported
through `api/index.js`.

## Before deploying: the Buffer app client

In Buffer, open **Settings → API** and create (or edit) the app client.

1. Enable the **`account:read`** and **`posts:read`** scopes. `offline_access`
   is required for refresh tokens, so enable it too if it is listed.
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
5. `curl -s https://<your-domain>/api/buffer/session` with the session cookie
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
only `/api/*` reaches the function. The rewrite is expected to preserve the
original `/api/...` path for Express, which the Buffer starter relies on. This
has not been exercised against a live deployment in this repository: after
deploying, check the deployment's Functions list shows `api/index.js` and that
`/api/buffer/session` returns `{ "connected": false, ... }` rather than a 404.
If nested paths do not reach Express, the fix is a catch-all function file
(for example `api/[...path].js`) that imports the same app, not a change to the
Express routes.
