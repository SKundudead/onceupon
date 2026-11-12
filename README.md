# OnceUpon v2 — Midnight Library and six-theme release

**Tagline:** Where every story finds its reader.  
**Default design:** Midnight Library. Additional themes: Paper & Ink, Enchanted Forest, Midnight Blue, Lavender Dreams and Minimalist.

This package extends the existing OnceUpon static frontend and Supabase project. It retains the current auth, catalogue, story reading, token wallet, author studio, author messaging, quest, moderation and publication workflows. The new database migration is additive; it does not delete or rewrite existing accounts, stories, token records or reading progress.

## Included

- Responsive layout with subtle animated atmosphere and reduced-motion support.
- Clickable profile photo/name in the header; profile editing, photo upload/removal, account security and six themes in Profile & Settings.
- Floating Ask AI and Contact Admin controls on the lower-right; token wallet dock on the lower-left.
- Separate reader-to-author messages and private reader-to-admin support chat with automatic message refresh.
- Expanded Administration view with approvals, author application review, story publication decisions, role tools, quest management/review, comment/review moderation, reports, analytics, catalogue export, support inbox and hosted-AI controls.
- Local writing helper with optional hosted generative AI through a secured Supabase Edge Function.
- PWA app-shell caching plus explicit offline downloads for pages the existing `get_story_page` RPC authorises. It never calls the page-unlock function and does not deduct tokens.

## Files to know

- `SUPPORT_AI_OFFLINE_UPGRADE.sql` — new additive migration for support conversations and AI settings/usage metadata.
- `supabase/functions/onceupon-ai/index.ts` — hosted AI Edge Function; provider secrets stay server-side.
- `UPGRADE_SETUP_GUIDE.md` — complete rollout, configuration and test checklist.
- `IMPLEMENTATION_MIGRATION.sql` and `FINAL_SUPABASE_PATCH.sql` — existing migrations retained from the supplied archive. Do not rerun them blindly if already applied.

## Required setup before the new backend features work

1. Take a Supabase backup/export before applying schema changes.
2. Review and run `SUPPORT_AI_OFFLINE_UPGRADE.sql` once in the Supabase SQL Editor. It adds separate `support_conversations`, `support_chat_messages`, `ai_feature_settings` and `ai_usage_events` tables with RLS. It relies on the existing `public.has_admin_role()` helper.
3. Deploy the Edge Function with `supabase functions deploy onceupon-ai`.
4. Add these Edge Function secrets in Supabase: `AI_PROVIDER_API_KEY`, `AI_PROVIDER_BASE_URL` (HTTPS OpenAI-compatible chat-completions URL), `AI_PROVIDER_MODEL`. Optionally add `AI_ALLOWED_ORIGIN=https://onceupon-sk.netlify.app`.
5. Select a provider/model whose free tier is available and acceptable at the time of configuration. Free quotas and models change; this project has no billing, paid fallback or automatic upgrade path.
6. Sign in as Owner/Admin, open Administration → Hosted AI settings, and enable the feature only after verifying the Edge Function and secrets.
7. Deploy the contents of this folder to the connected GitHub repository root / Netlify site.

## Offline reading

A reader must be signed in and approved to download. On a story page choose **Download unlocked pages for offline**. The app calls the existing protected `get_story_page` RPC for each page; only page content that the backend returns is stored in IndexedDB. Locked or inaccessible pages are skipped. The download never calls `unlock_story_page`. Copies are stored on the current browser/device and account, not synced to other devices. They are not DRM-encrypted; keep the browser profile/device private. Use Offline downloads to remove saved copies.

## AI privacy and budget

Hosted AI is off by default. It is called only when the user selects hosted AI and explicitly consents to send the prompt. The Edge Function verifies the Supabase session and account approval, applies per-user daily request and prompt-size limits, and records minimal metadata (user ID, model, status, character count and time)—not prompt text or model responses. AI does not use reading tokens. If the Edge Function/provider is not configured or available, the local helper remains available. Do not configure payment or a paid fallback.

## Existing project settings and security

- `config.js` keeps the existing Supabase URL and publishable key. Never put a service-role key, database password or AI provider key in frontend files or GitHub.
- Keep RLS enabled. Keep `profile-photos`, `quest-submissions` and `story-files` private; `story-covers` may remain public.
- Keep existing Supabase Auth and Storage policies intact. The archive does not include the complete original base-schema bootstrap, and this package cannot verify the live database or storage policies.
- Full database backup/restore must use Supabase-supported backup tools. Catalogue CSV is metadata only and intentionally excludes private story content and secrets.
- No payments, subscriptions, paid tokens or paid AI upgrade features exist in this project.

## Test before launch

Test login, profile photo change/removal, six themes, mobile navigation, all footer routes, reader progress, token claim/unlock, author messages, support chat from a separate test user/admin account, author approvals, story moderation, quests, AI local fallback, hosted AI only after server configuration, offline download of a free/unlocked page, blocked download of a locked page, and clearing an offline copy.

**Not live-tested here:** Supabase migration execution, RLS policy compatibility, Edge Function deployment, provider free-tier availability, email delivery and Netlify production behaviour. Those require your Supabase/Netlify accounts and should be verified before public release.


## Unified inbox, username sign-in and notifications

The release includes one combined Messages inbox with `[ADMIN]` and `[AUTHOR]` labels, username-based sign-in (email remains available), and a notification centre with unread counts and mark-all-read. Username sign-in requires `USERNAME_SIGNIN_MIGRATION.sql` and deployment of `supabase/functions/username-signin`; see `UPGRADE_SETUP_GUIDE.md`.
