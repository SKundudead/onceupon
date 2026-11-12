-- OnceUpon username sign-in + unified inbox compatibility
-- Apply in Supabase SQL Editor after taking a backup. This is additive.
begin;

create table if not exists public.account_usernames (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  username_normalized text generated always as (lower(username)) stored,
  created_at timestamptz not null default now(),
  constraint account_usernames_username_format check (username ~ '^[A-Za-z0-9_]{3,24}$')
);
create unique index if not exists account_usernames_username_unique
  on public.account_usernames(username_normalized);
alter table public.account_usernames enable row level security;
revoke all on public.account_usernames from anon, authenticated;
-- No client-side username-to-email lookup. Only the Edge Function service role can read mappings.

create or replace function public.capture_signup_username()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_username text;
begin
  v_username := nullif(trim(coalesce(new.raw_user_meta_data->>'username','')), '');
  if v_username is not null then
    if v_username !~ '^[A-Za-z0-9_]{3,24}$' then
      raise exception 'Username must be 3-24 characters using letters, numbers or underscores.';
    end if;
    insert into public.account_usernames(user_id, username)
    values(new.id, v_username);
  end if;
  return new;
end;
$$;
revoke all on function public.capture_signup_username() from public, anon, authenticated;
drop trigger if exists onceupon_capture_signup_username on auth.users;
create trigger onceupon_capture_signup_username
  after insert on auth.users
  for each row execute function public.capture_signup_username();

create or replace function public.set_my_username(p_username text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Sign in is required.'; end if;
  if p_username !~ '^[A-Za-z0-9_]{3,24}$' then
    raise exception 'Username must be 3-24 characters using letters, numbers or underscores.';
  end if;
  insert into public.account_usernames(user_id, username)
  values(auth.uid(), p_username)
  on conflict(user_id) do update set username=excluded.username;
exception
  when unique_violation then raise exception 'That username is already taken. Choose another.';
end;
$$;
revoke all on function public.set_my_username(text) from public, anon;
grant execute on function public.set_my_username(text) to authenticated;

-- Existing users keep their current email sign-in. They can claim a username
-- later using set_my_username through an authenticated settings flow.
commit;
