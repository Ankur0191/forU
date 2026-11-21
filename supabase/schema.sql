-- forU: two-account membership, durable chat history, read receipts, and private Realtime access.
-- This schema is also applied to the linked Supabase project.

create table if not exists public.foru_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (length(trim(username)) between 1 and 32),
  created_at timestamptz not null default now()
);
create unique index if not exists foru_members_username_lower_idx
  on public.foru_members (lower(username));

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 10000),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  constraint messages_no_blank check (length(trim(body)) > 0)
);
create index if not exists messages_created_at_idx on public.messages(created_at desc);

-- Only two users may be provisioned, and only through trusted SQL/admin access.
create or replace function public.foru_limit_members()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  current_count integer;
begin
  select count(*) into current_count from public.foru_members;
  if current_count >= 2 then
    raise exception 'forU is limited to exactly two authorised accounts';
  end if;
  return new;
end;
$$;

drop trigger if exists foru_limit_members_trigger on public.foru_members;
create trigger foru_limit_members_trigger
before insert on public.foru_members
for each row execute function public.foru_limit_members();

-- Message bodies and sender identity are immutable after insertion.
-- A recipient may set a read receipt once, and cannot alter message content.
create or replace function public.foru_guard_message_updates()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.sender_id is distinct from old.sender_id
     or new.body is distinct from old.body
     or new.created_at is distinct from old.created_at then
    raise exception 'Chat message content is immutable';
  end if;
  if old.read_at is not null or new.read_at is null then
    raise exception 'Read receipts can only be set once';
  end if;
  return new;
end;
$$;

drop trigger if exists foru_guard_message_updates_trigger on public.messages;
create trigger foru_guard_message_updates_trigger
before update on public.messages
for each row execute function public.foru_guard_message_updates();

alter table public.foru_members enable row level security;
alter table public.messages enable row level security;

drop policy if exists "foru members read own membership" on public.foru_members;
create policy "foru members read own membership"
on public.foru_members for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "foru members read chat history" on public.messages;
create policy "foru members read chat history"
on public.messages for select to authenticated
using (
  exists (
    select 1 from public.foru_members member
    where member.user_id = (select auth.uid())
  )
);

drop policy if exists "foru members send own messages" on public.messages;
create policy "foru members send own messages"
on public.messages for insert to authenticated
with check (
  sender_id = (select auth.uid())
  and exists (
    select 1 from public.foru_members member
    where member.user_id = (select auth.uid())
  )
);

drop policy if exists "foru recipients mark messages read" on public.messages;
create policy "foru recipients mark messages read"
on public.messages for update to authenticated
using (
  sender_id <> (select auth.uid())
  and read_at is null
  and exists (
    select 1 from public.foru_members member
    where member.user_id = (select auth.uid())
  )
)
with check (
  sender_id <> (select auth.uid())
  and read_at is not null
  and exists (
    select 1 from public.foru_members member
    where member.user_id = (select auth.uid())
  )
);

-- Newly created Supabase projects require explicit Data API grants as well as RLS.
grant usage on schema public to authenticated;
grant select on public.foru_members to authenticated;
grant select, insert, update on public.messages to authenticated;

-- Only these two provisioned accounts can use the private typing/presence channel.
drop policy if exists "foru receive private realtime" on realtime.messages;
create policy "foru receive private realtime"
on realtime.messages for select to authenticated
using (
  (select realtime.topic()) = 'foru:private-chat'
  and extension in ('broadcast', 'presence')
  and exists (
    select 1 from public.foru_members member
    where member.user_id = (select auth.uid())
  )
);

drop policy if exists "foru send private realtime" on realtime.messages;
create policy "foru send private realtime"
on realtime.messages for insert to authenticated
with check (
  (select realtime.topic()) = 'foru:private-chat'
  and extension in ('broadcast', 'presence')
  and exists (
    select 1 from public.foru_members member
    where member.user_id = (select auth.uid())
  )
);

-- Publish persisted message inserts and read-receipt updates to connected clients.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end;
$$;