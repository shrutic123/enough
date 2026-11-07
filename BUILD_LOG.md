# Build log

Short, dated entries. This is the evidence of what was built inside the contest window (Oct 28 - Nov 13, 2026), and it doubles as material for build-in-public posts.

## Day 1 - Nov 6
- Done: Verified the Buffer OAuth/PKCE, refresh-token and GraphQL reference, and read the official `app-client-starter-app`. Scaffolded Vite + React + TypeScript + Tailwind. Ported the server auth/session/GraphQL layer to one Express app at `/api`, with account, channels and queue reads. Built the queue card with the Keep/Cut motion and a dev-only fixture mode. Wrote `docs/PRD.md` and `docs/ARCHITECTURE.md`.
- Stuck on: The Buffer app client still needs the new redirect URI and `posts:read` before the first browser login. The Vercel rewrite is not live-tested.
- Next: Register `https://localhost:5173/api/auth/callback`, enable `account:read` and `posts:read`, complete the OAuth round trip, then wire Cut to `deletePost`.

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
