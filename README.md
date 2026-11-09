# OnceUpon — complete frontend release package

**Tagline:** Where every story finds its reader.

This is the refreshed static frontend package for the existing Supabase project. It uses the confirmed 23-table schema export supplied for this project; it does not create a second database or replace the existing data.

## Included

- `index.html`, `styles.css`, `app.js` — responsive reader, author, and administration interface.
- `config.js` — public Supabase URL and publishable-key configuration. The project URL is already filled in; paste the **publishable key** in the placeholder.
- `FINAL_SUPABASE_PATCH.sql` — compatibility SQL for chapter page metadata, quest submissions and moderation rewards, and approved public reviews. It also updates the new-user trigger to preserve optional phone metadata.
- `ASSIGN_FIRST_OWNER.sql` — one-time manual first-owner assignment. Run only after registering and verifying your own account.
- `manifest.webmanifest`, `sw.js`, `icon.svg` — installable PWA shell and static-asset caching. Private story content, account data, token balances, and Supabase API responses are never cached by the service worker.
- `_redirects`, `netlify.toml` — Netlify static hosting and SPA fallback.

## Features connected to the existing schema

### Reader
- Public published-story catalogue and story/chapter navigation.
- Page body delivery through `get_story_page`; the browser never queries `story_pages.content` directly.
- First five story-wide pages free; later pages use the existing `unlock_story_page` RPC and expiring token batches.
- Token balance/history and daily token claim through existing RPCs.
- Reading progress, bookmarks, private/public reading lists, moderated reviews and page comments.
- Notifications, support messages, and reports.
- Reading preferences: warm-paper/dark theme, text size, line spacing, high contrast; browser-native read-aloud where supported.

### Author
- Author application and status.
- Draft story, chapter, and page creation/editing under the existing author RLS policies.
- Authors submit stories for admin publication review; frontend does not publish stories directly.

### Administration
- Manual account approval/rejection.
- Author application approval/rejection through `review_author_application`.
- Story publication/rejection.
- Quest creation, evidence review, and atomic reward credit through `review_quest_submission`.
- Comment/review moderation, report resolution, support replies, and owner-only role grants.

## Important limitations and honest status

- This package is code-complete against the schema and RPC names documented in the project handover, but it has **not** been live-tested against your Supabase account or deployed Netlify site from this workspace.
- Supabase email delivery is controlled by your Auth email provider/template. The UI supports a six-digit email OTP if your Supabase template sends one; if your template sends a confirmation link, use that link. Do not assume delivery is configured until you test an actual signup.
- The PWA caches only the static app shell. It is not an offline reader and does not cache protected pages.
- Private `story-files` downloads are not exposed in this frontend. Keep that bucket private; do not make it public or add a service-role key to the browser. A secure Edge Function/signed-URL workflow would need to be deployed separately before using private story-file downloads.
- No payment, paid AI API, paid domain, or service-role key is used. Netlify's free `*.netlify.app` subdomain is sufficient.
- Supabase Free and Netlify Free have usage limits and service availability conditions. The project remains ₹0 only while usage stays within free-tier limits.

## Deployment — Android-friendly

### 1. Apply the SQL patch
1. Open the Supabase SQL Editor for project `trnsnbvvxgrscbcigpqe`.
2. Open `FINAL_SUPABASE_PATCH.sql` from this folder.
3. Copy the entire file into a new SQL query and run it once.
4. Confirm Supabase reports success. If it reports an error, stop and share the exact error; do not repeatedly run edited fragments.

The patch is designed to be safe to re-run, but run it once first and keep a copy of the result.

### 2. Set the public frontend key
1. Open `config.js`.
2. Keep the existing Supabase URL.
3. Replace `PASTE_YOUR_SUPABASE_PUBLISHABLE_KEY_HERE` with the project's **publishable key** (or legacy anon key, if that is what the project dashboard provides).
4. Do not use a `service_role` key, database password, or secret key.

### 3. Upload to GitHub
1. Open `https://github.com/SKundudead/onceupon` in Chrome.
2. Upload the contents of this folder to the repository root (not the ZIP file itself).
3. Ensure `index.html`, `app.js`, `styles.css`, `config.js`, `manifest.webmanifest`, `sw.js`, `icon.svg`, `netlify.toml`, and `_redirects` are at the root.
4. Commit the files to the main branch.

### 4. Deploy on Netlify
1. Open Netlify and choose **Add new site → Import an existing project**.
2. Connect GitHub if Netlify asks, then select `SKundudead/onceupon`.
3. Use the main branch, leave the build command blank, and set publish directory to `.`.
4. Deploy. Netlify will provide a free `*.netlify.app` address.

### 5. Create and assign the first Owner
1. Open your deployed site and register using your own email.
2. Complete Supabase email verification. Check spam and the Auth email configuration if no message arrives.
3. In Supabase SQL Editor, open `ASSIGN_FIRST_OWNER.sql`.
4. Replace `YOUR_VERIFIED_EMAIL_HERE` with the exact email used for the verified account; run it once.
5. Sign out and sign in again. The Administration section should appear.
6. In Administration, approve your own profile. Then approve other test accounts as needed.

Never make a public Owner-creation RPC and never grant Owner from the browser.

## First end-to-end test

Use a separate test reader account after the Owner is ready:
1. Register and verify the test account.
2. Approve it in Administration.
3. Create a small test quest and submit a response; approve it and confirm the reward appears in the token wallet.
4. Apply for author access from the account's author area; approve the application.
5. Create a draft story with one chapter and at least six pages; submit it for review and publish it from Administration.
6. Read the first five pages, then test a later page with a token cost.
7. Test bookmarks, a reading list, a review, a comment, a report, and a support message.

If a feature fails, capture the exact on-screen error and the relevant Supabase error. Do not disable RLS to make the interface work.

## Security reminders

- Keep RLS enabled on every app table.
- Keep `profile-photos`, `quest-submissions`, and `story-files` private; `story-covers` may remain public.
- The service-role key and database password must never appear in `config.js`, GitHub, Netlify environment variables exposed to client code, or browser source.
- Client-side controls are not security boundaries. Supabase RLS and SECURITY DEFINER RPC checks are the authority.
