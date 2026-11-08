# Enough — Product Requirements

**Status:** v1.0, Nov 8 2026 — built, deployed, live OAuth verified.
**Contest:** Buffer Commit 2026 (Oct 28 – Nov 13, 2026)
**Working name:** Enough
**Owner:** Shruti

> Restraint is not the opposite of creativity; it is what makes creativity legible.

---

## 1. Problem

People who post every day accumulate a queue they no longer mean:

- near-duplicate posts saying the same thing twice
- stale scheduled posts that made sense three weeks ago
- drafts padded with filler around one small idea
- too many posts on one channel in one week

Buffer's queue is an inventory. It shows everything and asks you to manage it. Decluttering needs a decision, not another dashboard. The queue should feel like an editing desk, not a debt.

## 2. Audience

**Primary:** solo creators and small-team social managers who post several times a week and have 20+ items in the queue.

**Secondary:** a judge who opens the app with their own Buffer account and has two minutes to understand it.

**Assumption:** at least one connected channel and a queue with some history. The app must still behave well with an empty queue.

## 3. Product idea

An editor's desk. The only accent is a proofreader's blue pencil, and it is used for exactly one thing: marking what gets cut.

- One 640px column, text left-aligned.
- One decision per card: **Keep** or **Cut**.
- The reward is the end state: **"Enough."**

The product is deliberately small. It does two things well rather than becoming a Buffer client.

**What changed in this release (Nov 8):** the release is **Keep/Cut plus the Essence editor**. It reads the real queue, shows one card at a time, and Cut deletes the post in Buffer. The editor trims a draft, shows the word-level diff, and sends the result as a queued post or a draft. Merge and ideas remain out of v1. The app is deployed at <https://enough-nu-flame.vercel.app> with the production OAuth callback registered and the live round trip verified.

## 4. Goals and non-goals

### Goals

- **G1** Connect through Buffer OAuth and read the user's real queue.
- **G2** Surface the queue one card at a time in due-date order, with a deterministic plain-language reason when there is one.
- **G3** Let the user Keep or Cut each item, where Cut deletes the real Buffer post.
- **G4** Trim a draft to one idea, show exactly which words were removed, and send the result to Buffer as a scheduled post or a draft.
- **G5** Feel calm and distinctive enough to be remembered. Target the Delight Award.

### Non-goals (v1)

- A full Buffer client: composer, calendar, analytics, media library.
- Editing or deleting ideas (the API does not support it; see §5).
- Merge in the first release (stretch goal; see §6.2).
- Team workflows, approvals, multi-account management.
- Undo history or versioning.
- Native mobile apps.
- Scheduling algorithms or best-time recommendations.

## 5. Buffer API constraints that shape the product

Verified against developers.buffer.com on Nov 6 2026.

| Constraint | Consequence |
|---|---|
| `createIdea` exists; no `updateIdea` or `deleteIdea` | Ideas cannot be kept/merged/cut. The declutter flow works on posts only. Ideas are not part of v1. |
| `deletePost(input: { id })` exists | Cut is a real delete. This is destructive and must be labelled. |
| `editPost` exists with `text` and `dueAt` | Merge is technically possible as edit + delete, but it is two calls with a partial-failure state. Deferred. |
| `createPost` with `saveToDraft: true` requires `channelId` | "Save as draft" needs a channel picker. Channel-less drafts use the experimental content-items API and are out of scope. |
| Post statuses: `draft`, `error`, `needs_approval`, `scheduled`, `sending`, `sent` | The review set reads `scheduled`, `draft`, `error`, `needs_approval`. Never `sent` or `sending`. |
| Refresh tokens rotate and reuse revokes the grant | Refresh in one server-side place only. |
| Redirect URIs must be HTTPS and match exactly | Local development uses `https://localhost:5173/api/auth/callback`; production gets its own registered URI. |

## 6. Features

### 6.1 Connect

**Build status:** built and verified in the browser locally and in production. Live OAuth, queue read, Cut and the editor all work against a real Buffer account.

**Flow**

1. First screen explains the tool in two sentences and offers one action: **Connect Buffer**.
2. OAuth 2.0 Authorization Code + PKCE, confidential client, server-side session.
3. On return: account, organizations and channels are read. If there are no channels, show a calm empty state.
4. Sign out clears the session cookie.

**Scopes**

`account:read`, `posts:read`, `posts:write`, `offline_access`. Request only the scopes enabled on the app client. The build requests exactly these, so Cut can delete and the editor can create. Ideas are out of v1, so no idea scope is requested.

**Acceptance**

- Fresh browser → Connect → consent → back → the queue loads.
- Denied consent shows a readable message and a way to try again.
- Expired access token refreshes silently. If refresh fails: "Your Buffer session expired. Connect again."
- No access token or refresh token is ever readable by page JavaScript.

### 6.2 Queue declutter

**Build status:** built and live. Queue read, the Keep/Cut card and the real Cut are verified in production.

**Input:** scheduled posts and drafts from the selected organization.

**Review set:** every queued post the read returns, up to 20 cards, in due-date order (missing dates last). The set is not pre-filtered: the human decides, not a model, and a run of calm decisions is the point. A post carries a deterministic reason when the status is `error` or the due date is in the past.

If there are no posts, go straight to the end screen.

**Card**

- The post text, large, at most 36ch per line.
- Channel name and due date, small and graphite.
- When there is one, a reason line: "This one didn't send." / "This was meant to go out already."
- Two text actions: **Keep** `K` and **Cut** `C`.
- A quiet count: "12 left."

**Actions**

- **Keep:** advance. No Buffer call. The post stays exactly as it is.
- **Cut:** `deletePost`. The pencil draws while Buffer deletes; once the delete is confirmed the sheet crumples as paper, the gap collapses, and focus moves to the next card's Keep action. The Cut button holds focus while the cut is in flight.
- **Cut failure:** the card stays, its reason is replaced by "Buffer couldn't delete that post. Try again." No local state is lost.

**Merge (stretch, not v1):** only for same-channel near-duplicates. Edit the kept post to include the other's unique line, then delete the other. If either call fails, stop and explain what happened.

**End**

When the review set is empty, show **"Enough."** in Instrument Serif italic. Subline: "12 kept. 8 cut." Secondary actions: "Back to Buffer", "Trim a draft", and "Start over".

**Acceptance**

- Keep makes no API call.
- Cut deletes the post in Buffer; a refresh in Buffer confirms it is gone.
- A failed Cut leaves the queue unchanged and the card in place.
- AI failure never blocks Keep/Cut.
- Removing a card does not lose keyboard focus.

### 6.3 Essence editor

**Build status:** built and exercised against Buffer: trim, diff, draft, queued post, Instagram image URL and notification scheduling.

**Flow**

1. Paste a draft.
2. Press **Trim**, directly under the sheet. The server returns the trimmed text. The client computes a word-level diff, marks each removed word with the blue pencil, then collapses the removed words with a 25ms stagger while the count goes from the original to the result. The sheet keeps one height through edit, diff and result, so the page does not jump.
3. If the model returns the draft unchanged, there is no mark to draw: go straight to the result and read "N words. Already tight."
4. The user can edit the result before sending.
5. Choose a channel and a destination:
   - **Scheduled post** — channel required; `addToQueue`.
   - **Draft** — channel required; `saveToDraft: true`.
6. **Send to Buffer** creates the chosen item and confirms what was created.

Instagram requires an image, so the editor asks for an optional public image URL when that channel is selected. Network character limits are checked before sending; TikTok, YouTube and Pinterest are blocked with a reason because this version sends text and images only.

**Rules**

- One idea only. No new facts, links, hashtags or emoji that were not in the original.
- Preserve the writer's voice and any @mentions or URLs.
- The diff must be truthful: every marked word is absent from the result and every unmarked word is present.
- If the AI call fails, the original text is untouched and the user can retry.

**Acceptance**

- The marked cuts match the diff exactly.
- The sheet height does not change between edit, diff and result.
- A draft the model leaves alone shows the result with "Already tight", not an empty animation.
- Sending creates a real item of the chosen type in Buffer.
- Errors are specific: what happened and what to do next.
- Reduced-motion users see fades and the final count, not the stagger.

### 6.4 End screen

**Build status:** built.

- **"Enough."** fades in while its letter-spacing tightens. This is the only unprompted motion in the app.
- Subline with the session totals.
- Links back to Buffer, into the Essence editor, and a start-over action.
- Reduced motion: fade only, no tracking change.

## 7. AI behaviour

**Build status:** built for the Essence trim. The queue audit was dropped in v1; reasons are deterministic.

### Queue audit (not in v1)

- Send only: post id, text, channel name, due date, status.
- Ask for a compact JSON result: duplicate groups, stale ids with a short reason, over-posting channel ids with counts.
- Validate every returned id against the fetched set. Ignore anything unknown.
- Deterministic fallback:
  - stale: `dueAt < now` or `status === 'error'`
  - over-posting: count per channel in a rolling 7 days
  - near-duplicate: normalized token overlap above a threshold
- The AI only suggests. The human clicks Cut. No automatic deletion.

### Essence

- Send the draft text only.
- Ask for the trimmed text only, not a list of indices. The client derives the diff, so the UI cannot mark a cut the model did not make.
- Cap output length; reject empty or wildly longer responses.
- Gemini runs at minimal thinking and defaults to `gemini-3.6-flash`, with one fallback to `gemini-3.5-flash-lite` when the newer model is unavailable or over quota. A free key usually takes that fallback; the trim still works.
- The route spends provider quota without a session, so it is capped at 20 requests per client per 10 minutes.

### Data

- No queue or draft content is stored beyond the request.
- The AI key is server-side only.
- Document the provider and what is sent in the README.

## 8. Design requirements

- Tokens and components from `enough.css`: fog, paper, ink, graphite, line, pencil.
- One 640px column, left-aligned. One card at a time.
- Type: Instrument Sans everywhere. Instrument Serif italic only for "Enough."
- The pencil accent is used only for cuts and focus. Never for decoration, success or links.
- Actions are plain text with key hints, not boxes.
- Motion answers an action:
  - Cut: strike draws (220ms) → confirmed delete → canvas crumple (650ms) with a synthesized rustle → gap collapses (280ms).
  - Keep: the sheet lifts, slides down and back under the pile (220ms) with a graphite "kept" note.
  - Essence: removed words are struck, then collapse with a 25ms stagger; the count shows the original and the result.
  - End: "Enough." settles once.
- Reduced motion: fades only, 120ms, no transforms or stagger.
- Copy: sentence case, plain verbs, no exclamation marks. Errors say what happened and what to do.
- Avoid the generic "cream paper + serif + terracotta" aesthetic.

## 9. Accessibility

- Full keyboard path: Tab to actions, `K` / `C` shortcuts, visible focus ring.
- After removing a card, move focus to the next card's Keep action; announce "Cut. 11 left." in a polite live region.
- Do not rely on colour alone: struck text plus the action label.
- Contrast checked in light and dark mode.
- Respect `prefers-reduced-motion`.
- Buttons are real `<button>` elements with accessible names.

## 10. Privacy and security

- OAuth tokens live in an encrypted, HttpOnly, Secure session cookie.
- `state` is verified on callback; PKCE verifier stays server-side.
- Refresh happens in one place; a rotated token is saved before use.
- Secrets stay in `.env` locally and in the host's environment in production. `.env` is gitignored.
- No tokens in `localStorage`, `sessionStorage`, or client JS.
- AI requests contain post text only, no account identifiers.
- Rate limits respected; 429 surfaces a wait time instead of retrying forever.

## 11. Success criteria

For judging (usefulness, execution and craft, creativity):

- A first-time user makes a meaningful decision within 30 seconds of connecting.
- The demo shows connect → review → cut → trim → send → "Enough." in under two minutes.
- No dead ends, no layout shift, no double submits.
- The cut crumple and the "Enough." screen are the two things a judge remembers.

For the build:

- Works end to end with real OAuth and real API calls.
- Publicly available through judging.
- Commit history and BUILD_LOG show what was built inside the window.

## 12. Milestones

| Date | Outcome |
|---|---|
| Nov 6 | Scaffold, OAuth/session/queue API, queue card + Keep/Cut motion, real Cut via `deletePost`, end screen, deploy config |
| Nov 7 | Real browser OAuth, queue read, Essence editor (trim, diff, send), Instagram image and notification scheduling, network guard, docs reconciled |
| Nov 8 | Deploy to Vercel, register the production redirect URI, smoke test |
| Nov 9 | Design pass, demo script |
| Nov 10 | Record the demo, add screenshots and links |
| Nov 11 | Final README and write-up |
| Nov 12 | Submit |
| Nov 13 | Cushion only |

## 13. Risks

| Risk | Mitigation |
|---|---|
| Deleting real posts during the demo | Use a dedicated test Buffer account/queue for recording; label Cut as destructive. |
| Redirect URI mismatch | One canonical URI per environment; log the exact URI the server sends. |
| AI inconsistency or latency | Deterministic fallbacks for audit; AI returns text only; client diff. |
| Token refresh collision | Single server-side refresh path; accept the cookie limitation for v1 and document it. |
| Scope creep | Merge is stretch. No composer, calendar or analytics. |
| Time | Protect the cut crumple and the end screen above everything else. |

## 14. Build status

**Last updated: Nov 8, 2026.**

| Area | Status |
|---|---|
| Repo + design tokens | Done before the window work (Nov 5) |
| Client scaffold | Done — Vite + React + TypeScript + Tailwind 3, local HTTPS on 5173 |
| OAuth + session | Built and verified locally and in production; both redirect URIs registered |
| Channels + queue read | Built — real queue, media thumbnail and network name on each card |
| Card + Keep/Cut | Built — strike, canvas crumple, collapse, keyboard, focus, live region, end screen, sheet stack, progress hairline, keep note; Cut calls `deletePost` and keeps the card on failure |
| Sound | Built — synthesized paper crumple at gain 0.3, header toggle, preference stored locally |
| Essence editor | Built — provider seam, trim, word-level diff, stable sheet height, editable result, draft and queued post |
| Network guard | Built — per-network character limits, required image for Instagram, notification scheduling for personal profiles, video/board channels blocked with a reason |
| Queue audit | Out of v1 |
| Deploy | Live at <https://enough-nu-flame.vercel.app>; production redirect URI registered; smoke test passed |
| README + video + submission | README current; video and submission pending |

### Resolved decisions

These were open disagreements; they are settled for v1.

| # | Decision |
|---|---|
| 1 | Review every post, up to 20, in due-date order. No AI audit. |
| 2 | Reasons are deterministic: an `error` status, a past `dueAt`. No model decides. |
| 3 | The review set is `scheduled`, `draft`, `error`, `needs_approval`. |
| 4 | One organization, chosen automatically. No organization picker. |
| 5 | Scopes are final: `account:read`, `posts:read`, `posts:write`, `offline_access`. |
| 6 | End screen offers "Back to Buffer", "Trim a draft", "Start over". No sign-out in v1. |
| 7 | Merge is out. Ideas are out. |
| 8 | One queue across networks. No per-network queues and no calendar/timeline view. |

## 15. Open questions

1. **Demo video:** record before the submission deadline; add the link to the README.
2. **Stronger model:** the current free Gemini key is quota-blocked on `gemini-3.6-flash`, so production takes the Lite fallback. Enabling billing or adding an OpenAI/Anthropic key would make the stronger model the normal path.
3. **Post-v1, only if time:** a "never cut these" list, or a density reason ("Third post that day"). Not before video and submission.
4. **Undo:** stays out. The demo uses a test account.
