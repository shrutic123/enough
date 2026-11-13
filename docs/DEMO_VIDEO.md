# Demo video

A repeatable way to record a one-minute demo of the deployed app with
Playwright, encode it with ffmpeg, and publish it from GitHub Actions.

The output is a silent 1920×1080, 30 fps H.264 MP4 with a short fade in and out.
Add a voiceover in any editor if you want one; the recorder leaves pauses for it.

## What records

`demo/record.mjs` drives the real production deployment:

1. Reads the queue and alternates **Keep** and **Cut** (real `deletePost` in live
   mode), with time to read each card.
2. Clears the queue to the **Enough.** screen.
3. Opens **Essence**, pastes a draft, presses **Trim**, shows the pencil diff,
   saves the result as a draft, then returns to **Enough.**

The pointer is drawn by an injected dot, so every move and click is visible.
Each run takes about a minute and never records in the background.

## Two data modes

| Mode | What it does | Use it for |
|---|---|---|
| `live` | A saved production session. Keep, Cut and create are real Buffer calls. | The submission video. |
| `fixture` | Intercepts `/api/*` in the browser with `demo/fixtures.mjs`. The page is the real production build; no Buffer data is touched. | Rehearsing the edit, testing the workflow, or recording when Buffer is unavailable. |

`auto` (the workflow default) chooses `live` when the session secret is present,
otherwise `fixture`. A fixture recording is published under a different asset
name, `enough-demo-fixture.mp4`, so it cannot be mistaken for the live one.

## Record locally

```bash
npm install
npx playwright install chromium
brew install ffmpeg            # once

# UI-only, no login, against the deployed app
DEMO_MODE=fixture npm run demo:record
npm run demo:encode

open demo/artifacts/enough-demo.mp4
```

Useful settings:

```bash
DEMO_URL=https://enough-nu-flame.vercel.app \
DEMO_MODE=fixture \
DEMO_CARDS=6 \
DEMO_SECONDS=60 \
DEMO_DECISIONS=cut,keep,cut,keep,cut,keep \
npm run demo:record
```

`DEMO_CARDS` caps how many cards are reviewed. If the live queue has more, the
video ends after the Essence save instead of the final **Enough.** screen.

## One-time setup for a live recording

Use a **dedicated test Buffer account**. Cuts are permanent, and a live run
alternates Keep and Cut through the queue.

1. Seed five or six posts in that account's queue. The fixture text in
   `demo/fixtures.mjs` is a good script: one old post, one long post, two
   near-duplicates, one error, one short post.
2. Connect that account to the production app in a normal browser once, using
   <https://enough-nu-flame.vercel.app>.
3. Capture that session for Playwright:

   ```bash
   npm run demo:capture -- https://enough-nu-flame.vercel.app
   ```

   Log in when the browser opens. The script waits for the callback, verifies
   `/api/buffer/session` is connected, and writes `demo/.auth/state.json`.
4. Put the file in a repository secret (base64, so line endings cannot corrupt
   it):

   ```bash
   base64 < demo/.auth/state.json | tr -d '\n' \
     | gh secret set DEMO_STORAGE_STATE --repo shrutic123/enough
   ```

5. Run the workflow with `mode=live` (see below). Re-capture the session if the
   app asks you to connect again.

Buffer rotates refresh tokens, so a live run can consume the saved grant. If the
next run lands on the Connect screen, re-capture. Never run two live recorders
against the same session at once; the refresh calls race and can revoke it.

The workflow file must be on the default branch before `gh workflow run` can
see it, so commit and push it first.

### Why the stable production alias

The session cookie is host-scoped and Buffer's redirect URI is registered
character for character. A per-deployment URL such as
`enough-abc123-shruti.vercel.app` is a different host: the saved cookie will not
be sent there, and the OAuth callback will not match. Always use the production
alias from **Vercel → Project → Domains**, for example:

```
https://enough-nu-flame.vercel.app
```

The workflow accepts it as the `url` input, or from a repository variable named
`PRODUCTION_URL`. The built-in fallback is the current alias above.

## Run in GitHub Actions

The workflow is `.github/workflows/demo-video.yml`. Trigger it from **Actions →
Demo video → Run workflow**, or:

```bash
# Verify the pipeline without touching Buffer (safe first run)
gh workflow run demo-video.yml -f mode=fixture

# The real thing; requires DEMO_STORAGE_STATE
gh workflow run demo-video.yml \
  -f mode=live \
  -f url=https://enough-nu-flame.vercel.app \
  -f cards=6 \
  -f seconds=60

gh run watch
```

The MP4 and a poster frame are uploaded as a workflow artifact. Tick
`publish=true` (or pass `-f publish=true`) to attach the MP4 to the
`demo-video` GitHub release. That gives the stable link to put in the README:

```
https://github.com/shrutic123/enough/releases/download/demo-video/enough-demo.mp4
```

If the release step fails with `Resource not accessible by integration`, enable
**Settings → Actions → General → Workflow permissions → Read and write
permissions** for `GITHUB_TOKEN`.

## What happens after a live run

The recorder deletes the posts it cuts. The Essence flow saves a draft, so it
does not add another card to the queue. Re-seed before the next live recording.

`demo/.auth/` is removed at the end of every workflow and is gitignored. Treat
the cookie like a password: it grants access to the connected Buffer account.

## Troubleshooting

| Symptom | Fix |
|---|---|
| “Production is showing the Connect screen” | The session is missing or expired. Re-run `demo:capture` and update `DEMO_STORAGE_STATE`. |
| “Buffer rejected the cut” | The post was already deleted, or the session lost write access. Re-seed the queue and reconnect. |
| Trim fails or times out | The deployment's AI key is missing or over quota. The workflow fails rather than recording an error state. |
| The queue is empty | Seed the test account, or use `DEMO_MODE=fixture`. |
| Video is longer than 60s | `DEMO_CARDS` is too high or the AI was slow. Lower it; the encoder trims the tail, but the final **Enough.** shot can be clipped. |
| Video is mostly blank at the start | The first fade covers the load. If fonts are slow, increase the initial wait in `demo/record.mjs`. |
| Vercel Deployment Protection blocks the runner | Use the public production alias, or add the protection bypass header. Production aliases are normally public. |
| Two live runs at once | Don't. Buffer rotates refresh tokens; concurrent runs can revoke the grant. The workflow has a concurrency group, but local runs are not guarded. |

## Notes on the recording

- Playwright records WebM at the viewport size; the encoder converts to MP4 and
  pads the final frame if the storyboard finishes early, so the output is
  exactly `DEMO_SECONDS`.
- The app's motion is captured at real speed. `prefers-reduced-motion` is
  explicitly disabled in the browser context.
- Playwright does not capture page audio, and the encoder writes the MP4 with
  no audio track. Add narration or music during editing.
