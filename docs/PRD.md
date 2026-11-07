# Enough — Product Requirements

**Status:** draft v0.2, Nov 6 2026
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

- One centered column, one card at a time.
- One decision per card: **Keep** or **Cut**.
- The reward is the end state: **"Enough."**

The product is deliberately small. It does two things well rather than becoming a Buffer client.

**What changed in this slice (Nov 6):** the first release is **Keep/Cut only**. It reads the real queue, shows one card at a time, and Cut deletes the post in Buffer. Merge remains a stretch goal. Ideas are create-only and are not part of this release.

## 4. Goals and non-goals

### Goals

- **G1** Connect through Buffer OAuth and read the user's real queue.
- **G2** Surface a short, ordered review set (near-duplicates, stale items, over-posting) with one plain-language reason per card.
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
| `createIdea` exists; no `updateIdea` or `deleteIdea` | Ideas cannot be kept/merged/cut. The declutter flow works on posts only. Ideas are a destination in the Essence editor. |
| `deletePost(input: { id })` exists | Cut is a real delete. This is destructive and must be labelled. |
| `editPost` exists with `text` and `dueAt` | Merge is technically possible as edit + delete, but it is two calls with a partial-failure state. Deferred. |
| `createPost` with `saveToDraft: true` requires `channelId` | "Save as draft" needs a channel picker. Channel-less drafts use the experimental content-items API and are out of scope. |
| Post statuses: `draft`, `error`, `needs_approval`, `scheduled`, `sending`, `sent` | The review set reads `scheduled`, `draft`, `error`, `needs_approval`. Never `sent` or `sending`. |
| Refresh tokens rotate and reuse revokes the grant | Refresh in one server-side place only. |
| Redirect URIs must be HTTPS and match exactly | Local development uses `https://localhost:5173/api/auth/callback`; production gets its own registered URI. |

## 6. Features

### 6.1 Connect

**Build status:** server-side OAuth and session built; not yet browser-tested.

**Flow**

1. First screen explains the tool in two sentences and offers one action: **Connect Buffer**.
2. OAuth 2.0 Authorization Code + PKCE, confidential client, server-side session.
3. On return: account, organizations and channels are read. If there are no channels, show a calm empty state.
4. Sign out clears the session cookie.

**Scopes**

`account:read`, `posts:read`, `posts:write`, `ideas:read`, `ideas:write`, `offline_access`. Request only the scopes enabled on the app client. **Current build requests exactly `account:read posts:read posts:write offline_access`**, so Cut can delete. The idea scopes are added when the Essence editor ships; every added scope needs a re-consent.

**Acceptance**

- Fresh browser → Connect → consent → back → the queue loads.
- Denied consent shows a readable message and a way to try again.
- Expired access token refreshes silently. If refresh fails: "Your Buffer session expired. Connect again."
- No access token or refresh token is ever readable by page JavaScript.

### 6.2 Queue declutter

**Build status:** queue read, the Keep/Cut card and the real Cut are built. The OAuth round trip has not been tested in a browser yet.

**Input:** scheduled posts and drafts from the selected organization.

**Review set:** a short ordered list, at most 20 cards.

1. Near-duplicates (pairs or groups; show one card at a time with "Similar to…" in graphite).
2. Stale items (due date in the past, or `error` status).
3. Over-posting (more than N posts on one channel in a rolling 7 days).
4. Everything else, only if the user asks to keep reviewing.

If nothing is flagged, go straight to the end screen.

**Card**

- The post text, large, at most 36ch per line.
- Channel name and due date, small and graphite.
- One reason line: "Nearly the same as another post" / "Scheduled three weeks ago" / "Five posts on LinkedIn this week."
- Two text actions: **Keep** `K` and **Cut** `C`.
- A quiet count: "12 left."

**Actions**

- **Keep:** advance. No Buffer call. The post stays exactly as it is.
- **Cut:** `deletePost`. The pencil draws while Buffer deletes; the card dissolves only once the delete is confirmed, then the gap collapses. Focus moves to the next card's Keep action.
- **Cut failure:** the card stays, its reason is replaced by "Buffer couldn't delete that post. Try again." No local state is lost.

**Merge (stretch, not v1):** only for same-channel near-duplicates. Edit the kept post to include the other's unique line, then delete the other. If either call fails, stop and explain what happened.

**End**

When the review set is empty, show **"Enough."** in Instrument Serif italic. Subline: "12 kept. 8 cut." Secondary actions: "Back to Buffer" and "Review again" (only if unflagged posts remain).

**Acceptance**

- Keep makes no API call.
- Cut deletes the post in Buffer; a refresh in Buffer confirms it is gone.
- A failed Cut leaves the queue unchanged and the card in place.
- AI failure never blocks Keep/Cut.
- Removing a card does not lose keyboard focus.

### 6.3 Essence editor

**Build status:** not started. `src/pages/Essence.tsx` is a placeholder page only.

**Flow**

1. Paste a draft, or arrive with text from a queue card ("Trim this instead").
2. Choose a destination:
   - **Scheduled post** — channel required; `addToQueue` or a custom time.
   - **Draft** — channel required; `saveToDraft: true`.
   - **Idea** — no channel; `createIdea`.
3. Press **Trim**.
4. The server returns the trimmed text. The client computes a word-level diff, marks each removed word with the blue pencil, then collapses the removed words with a 25ms stagger while the word count ticks down.
5. The user can edit the result before sending.
6. **Send to Buffer** creates the chosen item and confirms what was created.

**Rules**

- One idea only. No new facts, links, hashtags or emoji that were not in the original.
- Preserve the writer's voice and any @mentions or URLs.
- The diff must be truthful: every marked word is absent from the result and every unmarked word is present.
- If the AI call fails, the original text is untouched and the user can retry.

**Acceptance**

- The marked cuts match the diff exactly.
- Sending creates a real item of the chosen type in Buffer.
- Errors are specific: what happened and what to do next.
- Reduced-motion users see fades and the final count, not the stagger.

### 6.4 End screen

**Build status:** built.

- **"Enough."** fades in while its letter-spacing tightens. This is the only unprompted motion in the app.
- Subline with the session totals.
- Links back to Buffer and, when relevant, back to the remaining queue.
- Reduced motion: fade only, no tracking change.

## 7. AI behaviour

**Build status:** not started. No AI provider is wired.

### Queue audit

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
  - Cut: strike draws (220ms) → card dissolves (320ms) → gap collapses.
  - Keep: card slides right (180ms).
  - Essence: removed words are struck, then collapse with a 25ms stagger; the count ticks down.
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
- The cut dissolve and the "Enough." screen are the two things a judge remembers.

For the build:

- Works end to end with real OAuth and real API calls.
- Publicly available through judging.
- Commit history and BUILD_LOG show what was built inside the window.

## 12. Milestones

| Date | Outcome |
|---|---|
| Nov 6 | Scaffold, OAuth/session/queue API, queue card + Keep/Cut motion, real Cut via `deletePost`, end screen, deploy config (OAuth not browser-tested) |
| Nov 7–8 | Complete the browser OAuth round trip, keep/cut polish, Essence groundwork |
| Nov 9 | Essence editor, diff, send to Buffer; hard decision point on auth if blocked |
| Nov 10 | Queue audit, reasons, deterministic fallback, deploy |
| Nov 11 | README, demo script, screenshot/GIF |
| Nov 12 | Submit (app, write-up, video link) |
| Nov 13 | Cushion only |

## 13. Risks

| Risk | Mitigation |
|---|---|
| Deleting real posts during the demo | Use a dedicated test Buffer account/queue for recording; label Cut as destructive. |
| Redirect URI mismatch | One canonical URI per environment; log the exact URI the server sends. |
| AI inconsistency or latency | Deterministic fallbacks for audit; AI returns text only; client diff. |
| Token refresh collision | Single server-side refresh path; accept the cookie limitation for v1 and document it. |
| Scope creep | Merge is stretch. No composer, calendar or analytics. |
| Time | Protect the cut dissolve and the end screen above everything else. |

## 14. Build status

Update at the end of each session. **Last updated: Nov 6, 2026.**

| Area | Status |
|---|---|
| Repo + design tokens | Done before the window work (Nov 5) |
| Client scaffold | Done — Vite + React + TypeScript + Tailwind 3, local HTTPS on 5173 |
| OAuth + session | Built server-side; not browser-tested (redirect URI not yet registered) |
| Channels + queue read | Built server-side; the queue screen fetches the real queue |
| Card + Keep/Cut | Built — card, strike/dissolve/collapse, keyboard, focus, live region, end screen; Cut calls `deletePost` and keeps the card on failure |
| Essence editor | Not started (placeholder page only) |
| Queue audit | Not started |
| Deploy | Config prepared (`vercel.json`, `docs/DEPLOY.md`); not deployed or smoke-tested |
| README + video + submission | Not started |

### Discrepancies between code and PRD

These are real disagreements to settle, not silent edits to the product intent.

| # | PRD says | Code today | Needs a decision |
|---|---|---|---|
| 1 | Review only flagged items; go straight to the end screen if nothing is flagged. | Reviews every post, up to 20, in due-date order. No audit. | Keep all-posts review for v1 and rewrite this section, or build the audit first. |
| 2 | Reasons include near-duplicates and over-posting. | Only `error` status ("This one didn't send.") and a past due date ("This was meant to go out already."). | These two are deterministic; the rest need the audit. |
| 3 | Input is scheduled posts and drafts. | Requests `scheduled`, `draft`, `error`, `needs_approval`. | Confirm the wider filter is intended; the PRD already treats `error` as stale. |
| 4 | The queue is for the selected organization; if there are no channels, show a calm empty state. | The first organization is selected automatically. No organization or channel picker UI, the channels endpoint is not called by the UI, and a channel-less account falls through to the generic empty-queue message. | Confirm single-organization v1; decide whether a zero-channel empty state is needed. |
| 5 | Scopes include `ideas:read` and `ideas:write`. | Requests `account:read posts:read posts:write offline_access`. | Add the idea scopes when the Essence editor ships; each addition needs a re-consent. |
| 6 | End screen offers "Review again" when unflagged posts remain; sign out clears the session. | End offers "Back to Buffer" and "Start over" (a reload). No sign-out button, though `/api/auth/logout` exists. | Decide whether "Review again" and sign-out are in v1. |

## 15. Open questions

1. **Merge:** leave it out of v1 and add only if session 4 has room?
2. **AI provider:** which key does the builder already have? (Gemini keeps them on GCP; OpenAI or Anthropic are fine.)
3. **Default send mode:** `addToQueue` or a custom time? Current lean: add to queue, with a date shown before sending.
4. **Review set:** the current code reviews every post; the PRD leans flagged-only. Decide before the audit ships: review all, or flagged-only then "Enough."
5. **Undo:** none in v1. Confirm that deleting is acceptable, given the demo uses a test account.
