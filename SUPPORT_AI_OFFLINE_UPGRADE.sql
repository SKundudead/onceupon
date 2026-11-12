-- OnceUpon v2 additive upgrade. Run AFTER taking a Supabase backup.
-- This migration creates independent support-chat and AI-control tables; it does not
-- delete, rewrite or migrate existing accounts, stories, tokens or reading progress.
begin;

create table if not exists public.support_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subject text not null check (char_length(subject) between 1 and 160),
  status text not null default 'open' check (status in ('open','closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz
);
create index if not exists support_conversations_user_updated_idx on public.support_conversations(user_id,updated_at desc);
create index if not exists support_conversations_status_updated_idx on public.support_conversations(status,updated_at desc);
alter table public.support_conversations enable row level security;
drop policy if exists "support participants read conversations" on public.support_conversations;
create policy "support participants read conversations" on public.support_conversations for select to authenticated
  using (user_id=auth.uid() or public.has_admin_role());
drop policy if exists "users create own support conversations" on public.support_conversations;
create policy "users create own support conversations" on public.support_conversations for insert to authenticated
  with check (user_id=auth.uid());
drop policy if exists "support participants update conversation status" on public.support_conversations;
create policy "support participants update conversation status" on public.support_conversations for update to authenticated
  using (user_id=auth.uid() or public.has_admin_role())
  with check (user_id=auth.uid() or public.has_admin_role());
grant select,insert on public.support_conversations to authenticated;
revoke update on public.support_conversations from authenticated;
grant update(status,closed_at,updated_at) on public.support_conversations to authenticated;

create table if not exists public.support_chat_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.support_conversations(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 5000),
  created_at timestamptz not null default now()
);
create index if not exists support_chat_messages_conversation_created_idx on public.support_chat_messages(conversation_id,created_at);
alter table public.support_chat_messages enable row level security;
drop policy if exists "support participants read chat messages" on public.support_chat_messages;
create policy "support participants read chat messages" on public.support_chat_messages for select to authenticated
  using (exists(select 1 from public.support_conversations c where c.id=conversation_id and (c.user_id=auth.uid() or public.has_admin_role())));
drop policy if exists "support participants send chat messages" on public.support_chat_messages;
create policy "support participants send chat messages" on public.support_chat_messages for insert to authenticated
  with check (sender_id=auth.uid() and exists(select 1 from public.support_conversations c where c.id=conversation_id and c.status='open' and (c.user_id=auth.uid() or public.has_admin_role())));
grant select,insert on public.support_chat_messages to authenticated;

-- Publicly readable feature status contains no secrets. Only admins can change it.
create table if not exists public.ai_feature_settings (
  id boolean primary key default true check (id=true),
  hosted_enabled boolean not null default false,
  daily_request_limit integer not null default 10 check (daily_request_limit between 1 and 100),
  prompt_limit integer not null default 4000 check (prompt_limit between 500 and 8000),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.ai_feature_settings(id,hosted_enabled,daily_request_limit,prompt_limit)
values(true,false,10,4000) on conflict(id) do nothing;
alter table public.ai_feature_settings enable row level security;
drop policy if exists "anyone can read hosted AI availability" on public.ai_feature_settings;
create policy "anyone can read hosted AI availability" on public.ai_feature_settings for select to anon,authenticated using (true);
drop policy if exists "administrators update hosted AI settings" on public.ai_feature_settings;
create policy "administrators update hosted AI settings" on public.ai_feature_settings for update to authenticated
  using (public.has_admin_role()) with check (public.has_admin_role());
grant select on public.ai_feature_settings to anon,authenticated;
revoke update on public.ai_feature_settings from authenticated;
grant update(hosted_enabled,daily_request_limit,prompt_limit,updated_by,updated_at) on public.ai_feature_settings to authenticated;

-- Stores minimal request metadata only; prompts and generated replies are never stored.
create table if not exists public.ai_usage_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  model text not null,
  status text not null check (status in ('success','provider_error','rate_limited')),
  prompt_characters integer not null default 0 check (prompt_characters between 0 and 8000),
  created_at timestamptz not null default now()
);
create index if not exists ai_usage_events_user_created_idx on public.ai_usage_events(user_id,created_at desc);
alter table public.ai_usage_events enable row level security;
drop policy if exists "administrators read AI usage metadata" on public.ai_usage_events;
create policy "administrators read AI usage metadata" on public.ai_usage_events for select to authenticated using (public.has_admin_role());
grant select on public.ai_usage_events to authenticated;

commit;

-- Edge Function secrets (never commit these values):
-- AI_PROVIDER_API_KEY, AI_PROVIDER_BASE_URL (OpenAI-compatible /chat/completions endpoint),
-- AI_PROVIDER_MODEL. The feature remains disabled until a free provider is configured.
