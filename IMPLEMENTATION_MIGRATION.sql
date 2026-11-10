-- OnceUpon complete feature migration (Midnight Library release)
-- Review and run in Supabase SQL Editor after taking a database backup.
-- This migration adds only new profile fields/tables/views/triggers; it does not replace existing data.

begin;

alter table public.profiles
  add column if not exists bio text not null default '',
  add column if not exists instagram_url text,
  add column if not exists avatar_path text,
  add column if not exists is_profile_public boolean not null default true,
  add column if not exists online_visible boolean not null default false,
  add column if not exists last_seen_at timestamptz;

drop policy if exists "users update own public profile fields" on public.profiles;
create policy "users update own public profile fields" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
revoke update on public.profiles from authenticated;
grant update (full_name, phone, bio, instagram_url, avatar_path, is_profile_public, online_visible, last_seen_at, approval_status, updated_at) on public.profiles to authenticated;

alter table public.profiles
  drop constraint if exists profiles_bio_length_check;
alter table public.profiles
  add constraint profiles_bio_length_check check (char_length(bio) <= 1200);

-- Prevent readers from changing approval state or other privileged profile fields through the new update policy.
create or replace function public.guard_profile_self_update()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() = old.id and not public.has_admin_role() then
    if new.id is distinct from old.id or new.approval_status is distinct from old.approval_status then
      raise exception 'Approval status can only be changed by an administrator';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.guard_profile_self_update() from public, anon, authenticated;
drop trigger if exists onceupon_guard_profile_update on public.profiles;
create trigger onceupon_guard_profile_update before update on public.profiles
for each row execute function public.guard_profile_self_update();

-- Public author avatars remain in a private bucket; only the exact image selected on a public profile can be read.
create or replace function public.can_view_profile_photo(object_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.avatar_path = object_name and p.is_profile_public = true and p.approval_status = 'approved' and exists (select 1 from public.user_roles ur where ur.user_id = p.id and ur.role in ('author','admin','owner')))
$$;
revoke all on function public.can_view_profile_photo(text) from public;
grant execute on function public.can_view_profile_photo(text) to anon, authenticated;
drop policy if exists "public may view opted-in profile photos" on storage.objects;
create policy "public may view opted-in profile photos" on storage.objects for select to anon, authenticated
using (bucket_id = 'profile-photos' and public.can_view_profile_photo(name));

create or replace function public.is_author_account(target_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.user_roles ur where ur.user_id = target_user_id and ur.role in ('author','admin','owner'))
$$;
revoke all on function public.is_author_account(uuid) from public, anon;
grant execute on function public.is_author_account(uuid) to authenticated;

create table if not exists public.author_follows (
  id uuid primary key default gen_random_uuid(),
  follower_id uuid not null references auth.users(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint author_follows_not_self check (follower_id <> author_id),
  constraint author_follows_unique unique (follower_id, author_id)
);
alter table public.author_follows enable row level security;
drop policy if exists "followers read own follows" on public.author_follows;
create policy "followers read own follows" on public.author_follows for select to authenticated
  using (follower_id = auth.uid());
drop policy if exists "administrators read author follows" on public.author_follows;
create policy "administrators read author follows" on public.author_follows for select to authenticated
  using (public.has_admin_role());
drop policy if exists "authors see their followers" on public.author_follows;
create policy "authors see their followers" on public.author_follows for select to authenticated
  using (author_id = auth.uid());
drop policy if exists "users follow authors" on public.author_follows;
create policy "users follow authors" on public.author_follows for insert to authenticated
  with check (follower_id = auth.uid() and public.is_author_account(author_id));
drop policy if exists "users unfollow authors" on public.author_follows;
create policy "users unfollow authors" on public.author_follows for delete to authenticated
  using (follower_id = auth.uid());

create or replace view public.public_author_profiles as
select p.id, p.full_name, p.bio, p.instagram_url, p.avatar_path,
       p.online_visible,
       case when p.online_visible then p.last_seen_at else null end as last_seen_at,
       (p.online_visible and p.last_seen_at > now() - interval '5 minutes') as is_online,
       (select count(*)::integer from public.author_follows f where f.author_id = p.id) as follower_count,
       (select count(*)::integer from public.stories s where s.author_id = p.id and s.status = 'published') as published_story_count
from public.profiles p
where p.is_profile_public = true
  and p.approval_status = 'approved'
  and exists (select 1 from public.user_roles ur where ur.user_id = p.id and ur.role in ('author','admin','owner'));

create table if not exists public.author_threads (
  id uuid primary key default gen_random_uuid(),
  reader_id uuid not null references auth.users(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  subject text not null check (char_length(subject) between 1 and 160),
  status text not null default 'open' check (status in ('open','closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint author_threads_not_self check (reader_id <> author_id)
);
create index if not exists author_threads_reader_updated_idx on public.author_threads(reader_id, updated_at desc);
create index if not exists author_threads_author_updated_idx on public.author_threads(author_id, updated_at desc);
alter table public.author_threads enable row level security;
drop policy if exists "participants read author threads" on public.author_threads;
create policy "participants read author threads" on public.author_threads for select to authenticated
  using (auth.uid() = reader_id or auth.uid() = author_id or public.has_admin_role());
drop policy if exists "approved readers start author threads" on public.author_threads;
create policy "approved readers start author threads" on public.author_threads for insert to authenticated
  with check (reader_id = auth.uid() and public.is_approved_reader() and public.is_author_account(author_id));
drop policy if exists "participants update author threads" on public.author_threads;
create policy "participants update author threads" on public.author_threads for update to authenticated
  using (auth.uid() = reader_id or auth.uid() = author_id or public.has_admin_role())
  with check (auth.uid() = reader_id or auth.uid() = author_id or public.has_admin_role());

create table if not exists public.author_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.author_threads(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 5000),
  created_at timestamptz not null default now()
);
create index if not exists author_messages_thread_created_idx on public.author_messages(thread_id, created_at);
alter table public.author_messages enable row level security;
drop policy if exists "participants read author messages" on public.author_messages;
create policy "participants read author messages" on public.author_messages for select to authenticated
  using (exists (select 1 from public.author_threads t where t.id = thread_id and
    (auth.uid() = t.reader_id or auth.uid() = t.author_id or public.has_admin_role())));
drop policy if exists "participants send author messages" on public.author_messages;
create policy "participants send author messages" on public.author_messages for insert to authenticated
  with check (sender_id = auth.uid() and exists (select 1 from public.author_threads t where t.id = thread_id
    and (auth.uid() = t.reader_id or auth.uid() = t.author_id) and t.status = 'open'));

-- A restricted public view exposes only the opted-in public author fields, never email or phone.
-- Presence is visible only when explicitly enabled by the account owner.

create or replace function public.notify_newly_published_story()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'published' then
      insert into public.notifications (user_id, title, message, notification_type, is_read)
      select p.id, 'A new story is here', coalesce(new.title, 'A new story') || ' has just been published.', 'new_story', false
      from public.profiles p where p.approval_status = 'approved' and p.id is distinct from new.author_id;
    end if;
  elsif new.status = 'published' and old.status is distinct from 'published' then
    insert into public.notifications (user_id, title, message, notification_type, is_read)
    select p.id, 'A new story is here', coalesce(new.title, 'A new story') || ' has just been published.', 'new_story', false
    from public.profiles p where p.approval_status = 'approved' and p.id is distinct from new.author_id;
  end if;
  return new;
end;
$$;
revoke all on function public.notify_newly_published_story() from public, anon, authenticated;
drop trigger if exists onceupon_new_story_notification on public.stories;
create trigger onceupon_new_story_notification
  after insert or update of status on public.stories
  for each row execute function public.notify_newly_published_story();

create or replace function public.notify_author_message_recipient()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_reader uuid;
  v_author uuid;
  v_recipient uuid;
begin
  select t.reader_id, t.author_id into v_reader, v_author
  from public.author_threads t where t.id = new.thread_id;
  if v_reader is null or v_author is null then return new; end if;
  v_recipient := case when new.sender_id = v_reader then v_author else v_reader end;
  insert into public.notifications (user_id, title, message, notification_type, is_read)
  values (v_recipient, 'New author message', 'You have a new reply in an author conversation.', 'author_message', false);
  return new;
end;
$$;
revoke all on function public.notify_author_message_recipient() from public, anon, authenticated;
drop trigger if exists onceupon_author_message_notification on public.author_messages;
create trigger onceupon_author_message_notification after insert on public.author_messages
for each row execute function public.notify_author_message_recipient();

-- Restrict direct exposure of the new messaging and follows tables to their RLS policies.
grant select, insert, delete on public.author_follows to authenticated;
grant select, insert on public.author_threads to authenticated;
revoke update on public.author_threads from authenticated;
grant update (status, updated_at) on public.author_threads to authenticated;
grant select, insert on public.author_messages to authenticated;
grant select on public.public_author_profiles to anon, authenticated;

commit;

-- Storage setup (run separately if bucket does not already exist):
-- Create a PRIVATE bucket named profile-photos, max size 5 MB, MIME types image/jpeg,image/png,image/webp.
-- Object path must begin with the authenticated user's UUID. Existing project handover says this bucket
-- already exists with owner-folder RLS policies; verify those policies before using avatar uploads.
