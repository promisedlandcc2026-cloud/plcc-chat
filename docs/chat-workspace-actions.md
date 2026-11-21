# Ka Link workspace action inventory

The chat list and conversation remain the existing routes. The desktop sidebar renders the existing chat list; on mobile the list and room remain separate views. All data, eligibility checks, providers and handlers remain unchanged.

| Conversation | Header and navigation | Composer and other actions |
| --- | --- | --- |
| Ministry channel / group | Back on mobile; title; search; group info; Start Ka Link when eligible; archive; mute; open requests when present. Live indicator and join flow remain available. | Attachments, polls, share cards, requests, mentions, replies, edits, voice recordings, reactions and message actions retain their existing permission checks. |
| Direct message | Back on mobile; title; search; archive; separate audio and video call buttons when the existing DM call provider is available; mute; more options. | Attachments, replies, edits, voice recordings, reactions and message actions remain separate from the live audio/video call controls. Block/report and related DM actions remain in More. |
| All chat types | Prayer, Ministries, Messages and Live tabs, global message search, Bible, account menu and PLCC ONE remain in the chat list/sidebar. | Existing notices, search, moderation and permission-dependent controls remain available. |

The refactor does not change the app-level DM call or active Ka Link providers, incoming ringing, call handlers or provider fallback logic. These workflows still require signed-in two-account and real-device verification, including background, locking, keyboard and safe-area behavior. Layout should also be checked with long names and different permissions.
