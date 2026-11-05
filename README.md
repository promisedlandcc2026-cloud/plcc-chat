# PLCC Chat

Standalone chat and Live Huddle app for Promised Land Christian Center.

PLCC Chat has **no database of its own**. Rooms, messages, members and huddles all
live in the **PLCC Vault**, so PLCC Chat, Vault Chat and PLCC Connect always show the
same rooms and the same live calls. A huddle started in one app is live in all three.

## What it does

- Sign in with email or "Text me a code" (same accounts as Connect and the Vault)
- Channel list with unread counts, live-huddle badges, and new direct messages
- Room chat, plus Live Huddle (LiveKit, with the Daily backup line and outage fallback)
- Installable on phones (Add to Home Screen)

## Live Huddle rule

| Who | Start | Join | End for everyone |
| --- | --- | --- | --- |
| Super Admin, Pastor, Admin, First Lady, Secretary, Asst Secretary, Admin Staff | ✓ any room | ✓ | ✓ |
| Room moderator or creator (any role) | ✓ that room | ✓ | ✓ |
| Ministry Leader | ✓ own ministry's room | ✓ | as moderator |
| Member | – | ✓ rooms they can see | – |
| Either person in a direct call | ✓ | ✓ | – |

The Vault enforces this (`api/_utils/huddleStartPolicy.ts` in awc-vault). PLCC Chat asks
`huddle-can-start` only to hide the Start button from members; members see
"This huddle hasn't started yet…" until a leader or moderator starts it.

## How it's built

- Vite + React 19 + TypeScript + Tailwind (same design kit as Connect)
- `api/` are Vercel functions that forward to the Vault with the member's sign-in token:
  - `community-chat.js` — channels, messages, unread, directory, DMs, all huddle calls
  - `auth-phone.js` — "Text me a code" sign-in
  - `member-self.js` — confirms the member is approved in the Vault
  - `intercessors.js` — shows the Prayer Watch link (the Prayer Watch itself is in Connect)
- Paths match Connect (`/community/chat`, `/community/chat/:id`, `/sign-in`, `/auth/callback`)
  so shared room links work in both apps.

## Setup

1. Copy `.env.example` to `.env.local` and fill it in (same Supabase project as the Vault).
2. `npm install` then `npm run dev` (opens on port 3001; the API functions run locally too).
3. In Vercel, add the same variables to the project.
4. In Supabase → Authentication → URL Configuration, add
   `https://<your-awc-chat-domain>/auth/callback` to **Redirect URLs**.

## Checks

```
npm test        # bridge + huddle wiring tests
npm run typecheck
npm run build
```
