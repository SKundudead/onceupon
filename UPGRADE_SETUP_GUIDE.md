# OnceUpon v2 — upgrade and deployment guide

## What changed

- Six selectable visual themes; Midnight Library remains the default.
- Profile name and photo are directly accessible from the header.
- Floating Ask AI and built-in Contact Admin chat controls; token wallet docked at bottom-left.
- Support chat is separate from reader-to-author messages.
- Expanded admin workspace for approvals, publishing review, quests, moderation, reports, support inbox and hosted-AI controls.
- Optional hosted AI via a Supabase Edge Function, with local fallback.
- Explicit offline downloads for story pages that the server has already authorised. Downloading never unlocks a page or deducts tokens.

## Safe upgrade order

1. Keep the current Netlify deployment unchanged while preparing this release.
2. In Supabase, take a database backup/export first.
3. Your earlier OnceUpon screenshot showed `public.author_threads` was missing. In Supabase → Table Editor, check whether the author profile/message objects from `IMPLEMENTATION_MIGRATION.sql` exist. If that migration has not been applied, review and run it after the backup; it is additive and uses `IF NOT EXISTS` for tables/columns and replaces only its own named policies/triggers. Do not run it blindly if your schema has been manually changed.
4. Check whether the functions/policies in `FINAL_SUPABASE_PATCH.sql` are present. Apply that patch only if those compatibility/quest/page-access changes are still missing, after reviewing it against your live schema. Its owner-assignment block remains commented and is not needed if your Owner role already works.
5. Review and run `SUPPORT_AI_OFFLINE_UPGRADE.sql` after the prerequisite helper functions are present. It creates only support-chat and AI settings/usage tables; it does not drop or rewrite existing accounts, stories, token batches, reading progress, author threads or messages.
6. After applying the required SQL, refresh the Supabase API schema cache with `NOTIFY pgrst, 'reload schema';` from the SQL Editor, then reload OnceUpon.
7. Deploy the Edge Function using the Supabase CLI from the project folder: `supabase functions deploy onceupon-ai`.
8. Add Edge Function secrets in Supabase (Dashboard → Edge Functions → onceupon-ai → Secrets, or the CLI):
   - `AI_PROVIDER_API_KEY`
   - `AI_PROVIDER_BASE_URL` — the provider's HTTPS OpenAI-compatible chat-completions endpoint
   - `AI_PROVIDER_MODEL`
   - Optional `AI_ALLOWED_ORIGIN` — set to `https://onceupon-sk.netlify.app`
9. Choose a provider/model whose free tier is currently available and acceptable at the time of configuration. Free quotas and models change; this project has no billing, paid fallback or automatic upgrade path. Do not configure billing or automatic paid upgrades.
10. Upload the contents of `onceupon-main` to the connected GitHub repository root, or deploy the extracted folder to Netlify. A connected GitHub repository should trigger the build automatically.
11. Sign in as Owner/Admin, open Administration → Hosted AI settings, and enable hosted AI only after the Edge Function and secrets are configured.
12. Test sign-in, profile, tokens, story pages, support messages, author messages, administration and offline downloads with a non-owner test account before announcing the release.

## Offline reading behaviour

Offline copies are stored in IndexedDB on that browser/device. The download action calls the existing `get_story_page` RPC for each page; a locked or otherwise inaccessible page is skipped. The download action does not call `unlock_story_page`, cannot spend tokens, and does not bypass row-level security. A minimal local identity marker (account UUID, display name and approved flag) lets the installed app open the local offline library when the network or hosted Supabase JavaScript library is unavailable. It does not contain an access token or password and cannot perform online actions. Copies are per signed-in account and device. They are not encrypted DRM; anyone with access to the same unlocked browser profile/device may be able to view locally saved copies. Sign out removes the offline identity marker; signing back in restores access to that account's saved copies. Use Offline downloads to remove a story's local copy.

## Hosted AI privacy and budget

The browser sends a prompt to the Supabase Edge Function only when the user selects hosted AI and ticks the explicit consent checkbox. The Edge Function verifies the user's Supabase session and approval, checks the admin-set daily limit, and sends only the prompt to the configured provider. OnceUpon stores minimal usage metadata (user ID, model, status, prompt character count and timestamp), not the prompt or response. AI does not consume reading tokens. If the provider is absent, disabled, over quota or unreachable, the local helper remains available. Provider free tiers are external and not guaranteed; no paid fallback is implemented.

## Important external setup still required

- Apply `SUPPORT_AI_OFFLINE_UPGRADE.sql` to enable the new support inbox and AI controls.
- Deploy the `onceupon-ai` Edge Function and configure a suitable free provider's secrets to use actual generative AI.
- Review Supabase Auth, RLS, Storage bucket policies and the existing base schema before production launch. The project ZIP does not include the full original database bootstrap schema. The upgrade deliberately does not rewrite the existing daily-token grant/expiry functions or global page-free rules because their original definitions are not included; existing page-cost fields remain available in the story editor. Do not assume global token-policy controls have been added by this release.
- Supabase database backups and restores must be done using Supabase-supported tools; the browser dashboard does not export private database contents.

## Security notes

- `config.js` contains only the Supabase publishable key. Never put a service-role key, database password or AI provider key in frontend files or GitHub.
- Existing `FINAL_SUPABASE_PATCH.sql`, `IMPLEMENTATION_MIGRATION.sql` and `ASSIGN_FIRST_OWNER.sql` are retained as supplied. Do not rerun them blindly if they were already applied. The new incremental migration is `SUPPORT_AI_OFFLINE_UPGRADE.sql`.
- No payments, subscriptions, paid tokens or paid AI upgrade path are included.


## Additional release: unified inbox, usernames and notifications

This package also includes:
- One Messages inbox combining `[AUTHOR]` conversations and `[ADMIN]` support chats. The labels distinguish the conversation type even when the same account has both roles.
- Username at registration and username-or-email sign-in. Email remains private and is still used for verification and password recovery.
- Notification centre with unread count and a **Mark all as read** action. Existing notification rows are retained.

### Required Supabase setup for username sign-in
1. Back up your Supabase project first.
2. Open **SQL Editor** and run `USERNAME_SIGNIN_MIGRATION.sql`.
3. Deploy the `supabase/functions/username-signin` Edge Function.
4. Set these Edge Function secrets in Supabase (do not put them in `config.js` or the browser):
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
5. Test with a new test account before asking existing users to change their sign-in routine.

The username migration is additive. Existing users continue to sign in with email until they claim a username; their accounts, stories, tokens and reading progress are not replaced. New registrations save the username in signup metadata, and the database trigger reserves it case-insensitively.

### Important limitations / deployment checks
- Username sign-in is not active on the live site merely by uploading this ZIP: the SQL migration and Edge Function must also be deployed.
- The Edge Function uses the service-role key only server-side. Never publish that key.
- The Edge Function currently returns generic invalid-credential errors to avoid disclosing whether a username exists. Add provider-level rate limiting / CAPTCHA before a public high-traffic launch.
- Existing email verification and password-reset workflows still use email.
- Support and author chats remain separate secure database conversation types, presented in one combined inbox. Existing RLS policies must remain enabled.
