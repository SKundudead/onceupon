# OnceUpon — Midnight Library release

**Tagline:** Where every story finds its reader.  
**Design:** Midnight Library — charcoal, antique gold, warm ivory and literary serif typography.

This release builds on the existing OnceUpon static frontend and Supabase project. It preserves the original authentication, catalogue, reader, token wallet, author studio, quests and administration workflows, and adds the next set of requested features in one integrated package.

## Included in this release

### Reader and public experience
- Midnight Library theme as the default, with Warm Paper and device/system theme choices.
- Responsive navigation, mobile layout, expanded footer, About, FAQ, user guide, privacy/community guidance, support contacts and PWA install prompt.
- Public story catalogue and author directory with public author profile pages.
- Dedicated notification centre and in-app toast alerts for newly published stories (polling while the app is open).
- Reader preferences for font family, text size, line spacing, contrast and reduced motion.

### Profiles and privacy
- Edit display name, phone, biography, Instagram URL and profile visibility.
- Upload a JPG/PNG/WebP profile photo up to 5 MB to the existing private `profile-photos` bucket.
- Change email through Supabase confirmation and update password through Supabase Auth.
- Opt-in online presence. When disabled, the public author view does not expose last-seen information.
- Public author profiles expose only selected public fields; email and phone are not included in the public author view.

### Author community
- Follow and unfollow authors.
- Reader-to-author conversations with message history and close/reopen controls.
- No ordinary user-to-user private chat.
- Author application and existing writing studio remain connected to the existing workflow.

### AI assistant
- “Ask OnceUpon AI” includes a no-cost, browser-local helper for catalogue discovery, plot brainstorming, character development and writing feedback.
- It does not call an external language model and does not send prompts to a third party. This is an honest free fallback, not a full generative AI integration.

### Administration and recovery
- Admin analytics for members, published/pending stories, author follows and author conversations.
- Published catalogue CSV export.
- Full database backup is intentionally directed to the export/backup method supported by your Supabase plan; automated backup availability depends on the plan. A browser-only frontend cannot safely produce a full database dump or restore the entire Supabase project. Private story pages, auth secrets and private files are never included in the CSV export.
- Existing account, author, story, quest, moderation, report and support administration is retained.

## Supabase setup — important

The new profile, follow, author-conversation, public-author-view and publication-notification features require the included migration.

1. Open your Supabase project: `https://supabase.com/dashboard/project/trnsnbvvxgrscbcigpqe`.
2. In **SQL Editor**, run `FINAL_SUPABASE_PATCH.sql` first if it has not already been applied.
3. Run `IMPLEMENTATION_MIGRATION.sql` once. It adds the profile fields, RLS-protected follow and conversation tables, restricted public author view, private-photo read policy for opted-in public author avatars, and the publication-notification trigger.
4. Confirm the `profile-photos` storage bucket exists and remains **private**, with a 5 MB limit and JPEG/PNG/WebP MIME types. Preserve the existing own-user-folder upload policies.
5. Do not disable RLS. Do not add a service-role key to frontend files.

The migration is designed to be re-runnable. It does not assign an Owner role and does not change existing story or token data. It assumes the project's existing helper functions (`has_admin_role()` and `is_approved_reader()`) from the previously established schema are present.

## Frontend configuration

Open `config.js` and replace `PASTE_YOUR_SUPABASE_PUBLISHABLE_KEY_HERE` with the project's **publishable** key (or legacy anon key). Keep the existing Supabase URL. Never use a service-role key, secret key or database password in browser code.

## Deploy

1. Upload the contents of this folder to the root of `https://github.com/SKundudead/onceupon`.
2. Keep the Netlify site connected to that repository and deploy the main branch with no build command and publish directory `.`.
3. Open the deployed site, sign in and test the features below before announcing it publicly.

## End-to-end test checklist

- Register, verify email and approve a test account.
- Edit profile details, upload an avatar, change password and test email-change confirmation.
- Enable and disable online visibility; verify that hidden presence is not shown publicly.
- Assign author role, publish a public author profile and test follow/unfollow.
- Start a reader-to-author conversation; reply as the author; close and reopen it.
- Publish a story and verify a notification is inserted for approved readers and appears in the notification centre/toast while the app is open.
- Test catalogue discovery, reading, first-five-pages-free behavior, page unlocks, bookmarks, lists, token claims and quests.
- Test dark/light/system themes, font, spacing, contrast, reduced motion and PWA installation.
- Verify admin analytics and catalogue CSV export.

## Honest limitations

- This workspace cannot access your live Supabase dashboard or Netlify deployment, so database migration success, storage policies, email delivery, RLS behavior and production runtime have not been live-tested here.
- The AI assistant is a local rules-based fallback, not a hosted LLM.
- Publication and author-message notifications use database triggers, in-app notifications and periodic polling while the site is open. Browser push notifications while the app is closed are not configured.
- Backup instructions and catalogue CSV export are included; full database backup/restore must be performed through Supabase's supported dashboard/backup facilities.
- PWA installation availability depends on the browser and deployment being served over HTTPS.
- No payments, subscriptions, paid APIs or service-role keys are included.

## Security reminders

- Keep RLS enabled on all Supabase tables.
- Keep `profile-photos`, `quest-submissions` and `story-files` private; `story-covers` may remain public.
- Public author profiles are exposed through the restricted `public_author_profiles` view, not by making the full `profiles` table public.
- Do not share OTPs, passwords, API secrets or database credentials.
