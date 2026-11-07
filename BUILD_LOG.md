# Build log

Short, dated entries. This is the evidence of what was built inside the contest window (Oct 28 - Nov 13, 2026), and it doubles as material for build-in-public posts.

## Day 1 - Nov 6
- Done: Verified the Buffer OAuth/PKCE, refresh-token and GraphQL reference, and read the official `app-client-starter-app`. Scaffolded Vite + React + TypeScript + Tailwind. Ported the server auth/session/GraphQL layer to one Express app at `/api`, with account, channels and queue reads. Built the queue card with the Keep/Cut motion and a dev-only fixture mode. Wired Cut to `deletePost` behind a same-origin mutation route, with the card dissolving only after Buffer confirms the delete. Wrote and reconciled `docs/PRD.md` and `docs/ARCHITECTURE.md`.
- Stuck on: The Buffer app client still needs the localhost redirect URI and the `account:read`, `posts:read`, `posts:write`, `offline_access` scopes before the first browser login. The Vercel rewrite is not live-tested.
- Next: Register `https://localhost:5173/api/auth/callback`, enable those scopes, complete the OAuth round trip, and cut one test post end to end.

## Day 2 - Nov 7
- Done: Finished the browser OAuth round trip against real Buffer and reviewed a real queue with K/C. Built the Essence editor end to end: provider seam (Gemini/OpenAI/Anthropic), `/api/ai/essence`, browser-computed word diff, and `createPost` as a queued post or a draft. Fixed two live Buffer constraints: Instagram personal profiles need notification scheduling, and Instagram requires media, so the editor now accepts an optional public image URL. Added media thumbnails, media-only cards, and the network name to the queue card. Added a per-network limit guard so over-limit and video/board-only channels fail with a sentence instead of Buffer's generic error. Ran the design pass: the card is a sheet on a two-edge stack, the count has a shrinking hairline, Keep settles the sheet and leaves a graphite "kept" note in the margin, and the connect screen is one promise and one action. Reconciled `docs/PRD.md` and `docs/ARCHITECTURE.md` with the built slice.
- Stuck on: Production deployment and the production redirect URI are still open. The network guard and the new design pass are checked in the browser via the demo queue, not against a live send.
- Next: Deploy to Vercel, register the production callback, smoke test, then record the demo video.
- Later, Nov 7: Anchored the review screen so the count and the sheet's top edge stay fixed while card heights change; the card keeps its natural height and the page, not the card, scrolls. Added the persisted text-only crumple-sound toggle; the rustle is synthesized and plays only after Buffer confirms a cut, never on Keep. Wrote the first `npm test` suite (Node's test runner, no new dependencies) for the sound preference: 8 tests including blocked storage. The layout fix was checked red/green in the browser: header top moved 159-324px across six cards before, then held at 229px for all six after.
- Later, Nov 7 (continued): Reworked the rustle from a six-grain tap into four clustered bursts of 2.5-10 ms snaps so it reads as paper folding rather than water or a pen tap; master gain 0.22 (about -24 dBFS peak). Added a preview when the toggle turns on. Moved keyboard focus to Cut before the crumple begins, and added an input-modality tracker so the focus ring reliably reappears after a pointer click once the user starts tabbing. Verified in the browser: Tab after a mouse Keep now shows the blue ring on Cut and Keep.

## Day 3 - [date]
- Done:
- Stuck on:
- Next:

## Day 4 - [date]
- Done:
- Stuck on:
- Next:

## Day 5 - [date]
- Done: [README finished, demo recorded, submitted]
