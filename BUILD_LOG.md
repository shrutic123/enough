# Build log

Short, dated entries. This is the evidence of what was built inside the contest window (Oct 28 - Nov 13, 2026), and it doubles as material for build-in-public posts.

## Day 1 - Nov 6
- Done: Verified the Buffer OAuth/PKCE, refresh-token and GraphQL reference, and read the official `app-client-starter-app`. Scaffolded Vite + React + TypeScript + Tailwind. Ported the server auth/session/GraphQL layer to one Express app at `/api`, with account, channels and queue reads. Built the queue card with the Keep/Cut motion and a dev-only fixture mode. Wired Cut to `deletePost` behind a same-origin mutation route, with the card dissolving only after Buffer confirms the delete. Wrote and reconciled `docs/PRD.md` and `docs/ARCHITECTURE.md`.
- Stuck on: The Buffer app client still needs the localhost redirect URI and the `account:read`, `posts:read`, `posts:write`, `offline_access` scopes before the first browser login. The Vercel rewrite is not live-tested.
- Next: Register `https://localhost:5173/api/auth/callback`, enable those scopes, complete the OAuth round trip, and cut one test post end to end.

## Day 2 - [date]
- Done:
- Stuck on:
- Next:

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
