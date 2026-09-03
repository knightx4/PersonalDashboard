-- Share links: a page someone with no account opens, reads, and answers.
--
-- Deliberately module-agnostic. Nothing here knows about board games, prices
-- or photos -- `kind` says which page to draw and which response shape is
-- legal, and that enum is the seam every future use case comes in through.
-- See docs/SHARE-LINKS-SPEC.md.
--
-- The read and write functions that anon actually calls live in 0041. This
-- migration is only the shape of the data, and every table here is closed to
-- anon: no policy, no grant. An anonymous visitor never touches a table.

set search_path = public, extensions;

do $$ begin
  create type share_link_kind as enum ('disposition');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type share_link_status as enum ('active', 'archived');
exception when duplicate_object then null;
end $$;

-- Polymorphic on purpose: the share layer holds subjects, and what a subject
-- is belongs to the module that put it there. `inventory_item` is the only
-- member today, and adding one is an enum value plus a prune trigger (below).
do $$ begin
  create type share_subject_type as enum ('inventory_item');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type share_link_event_kind as enum (
    'viewed', 'responded', 'item_added', 'item_removed',
    'regrouped', 'token_issued', 'token_revoked'
  );
exception when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- The share itself
-- ---------------------------------------------------------------------------
create table share_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind share_link_kind not null default 'disposition',
  title text not null,
  intro text,
  status share_link_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint share_links_title_len_ck check (char_length(trim(title)) between 1 and 120),
  constraint share_links_intro_len_ck check (intro is null or char_length(intro) <= 2000)
);

create index share_links_user_idx on share_links (user_id);

create trigger share_links_touch_updated_at
  before update on share_links
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- The credential is a row, not a column
-- ---------------------------------------------------------------------------
--
-- 0017_public_case_page put `public_slug` on the record it shared, which works
-- for exactly one anonymous reader and stops working the day you want two.
-- A table instead means:
--
--   * "share with a specific person" later is an insert with a different
--     label, and a revoke on the open one. No schema change, and no change to
--     the signature of the functions in 0041.
--   * rotating a leaked link is an insert plus a revoke, and the answers
--     already given survive it.
--   * `can_respond` exists so a read-only link is expressible without
--     inventing a second concept.
--
-- `expires_at` is nullable, unlike the case page, which requires an expiry. A
-- link to an employer should die on its own; a form for someone in the house
-- should not silently stop working in a fortnight.
create table share_link_tokens (
  id uuid primary key default gen_random_uuid(),
  share_link_id uuid not null references share_links (id) on delete cascade,
  token text not null,
  label text not null default 'Anyone with the link',
  can_respond boolean not null default true,
  expires_at timestamptz,
  revoked_at timestamptz,
  -- Touched by the anonymous read, so "has she opened it yet" is answerable
  -- without reading the event log.
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- 24 characters is the floor the read function also enforces, so a
  -- truncated token cannot become a short one that happens to match.
  constraint share_link_tokens_token_len_ck
    check (char_length(token) between 24 and 128),
  constraint share_link_tokens_label_len_ck
    check (char_length(trim(label)) between 1 and 80)
);

create unique index share_link_tokens_token_key on share_link_tokens (token);
create index share_link_tokens_share_idx on share_link_tokens (share_link_id);

create trigger share_link_tokens_touch_updated_at
  before update on share_link_tokens
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- What is on the share
-- ---------------------------------------------------------------------------
--
-- One row per real unit. Three copies of the same game are three rows, because
-- they are three things I own and one of them might get sold.
--
-- `group_key` and `family_key` are denormalized here on purpose. They are
-- computed by the application from the grouping layer (0040) when an item is
-- added, and recomputed by an explicit regroup. Storing them is what lets the
-- anonymous write function answer "how many units does this group have?" with
-- a count against a table it already trusts, instead of taking a quantity from
-- the caller.
create table share_link_items (
  id uuid primary key default gen_random_uuid(),
  share_link_id uuid not null references share_links (id) on delete cascade,
  subject_type share_subject_type not null default 'inventory_item',
  subject_id uuid not null,
  group_key text not null,
  family_key text,
  position integer not null default 0,
  added_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint share_link_items_group_key_len_ck
    check (char_length(group_key) between 1 and 200),
  constraint share_link_items_family_key_len_ck
    check (family_key is null or char_length(family_key) between 1 and 200),
  constraint share_link_items_subject_key
    unique (share_link_id, subject_type, subject_id)
);

-- The quantity count in share_respond() is exactly this index.
create index share_link_items_share_group_idx
  on share_link_items (share_link_id, group_key);
-- "is this item on any share" for the chip on the inventory row.
create index share_link_items_subject_idx
  on share_link_items (subject_type, subject_id);

create trigger share_link_items_touch_updated_at
  before update on share_link_items
  for each row execute function public.touch_updated_at();

-- A polymorphic subject_id cannot carry a foreign key, and an orphan is not
-- cosmetic here: it would keep counting toward a group's quantity after the
-- thing itself was deleted, so the form would offer her three boxes when two
-- exist. One prune trigger per subject type, added alongside the enum value.
create or replace function public.prune_share_items_for_inventory()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.share_link_items
   where subject_type = 'inventory_item'
     and subject_id = old.id;
  return old;
end;
$$;

revoke all on function public.prune_share_items_for_inventory()
  from public, anon, authenticated;

create trigger inventory_items_prune_share_items
  after delete on inventory_items
  for each row execute function public.prune_share_items_for_inventory();

-- ---------------------------------------------------------------------------
-- Her answers
-- ---------------------------------------------------------------------------
--
-- Keyed by group, not by item. She is choosing "sell two of the three", and
-- which two is not a question anyone can answer about identical boxes. The
-- mapping from counts to specific inventory rows happens on the owner's side,
-- deliberately, at apply time.
--
-- The "sums to no more than the quantity" rule is NOT here: a check constraint
-- cannot count rows in another table. It lives in share_respond(), which is
-- also the only thing that may write this table on anon's behalf.
create table share_link_responses (
  id uuid primary key default gen_random_uuid(),
  share_link_id uuid not null references share_links (id) on delete cascade,
  group_key text not null,
  keep_qty integer not null default 0,
  sell_qty integer not null default 0,
  giveaway_qty integer not null default 0,
  note text,
  answered_by_token uuid references share_link_tokens (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint share_link_responses_group_key
    unique (share_link_id, group_key),
  constraint share_link_responses_qty_ck
    check (keep_qty >= 0 and sell_qty >= 0 and giveaway_qty >= 0),
  constraint share_link_responses_note_len_ck
    check (note is null or char_length(note) <= 500)
);

create index share_link_responses_share_idx on share_link_responses (share_link_id);
create index share_link_responses_token_idx on share_link_responses (answered_by_token);

create trigger share_link_responses_touch_updated_at
  before update on share_link_responses
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- What happened
-- ---------------------------------------------------------------------------
--
-- Append-only, and doing three jobs at once: it is the rate limit's counter,
-- it is the "she opened it and changed her mind twice" history in my UI, and
-- it is how a vandalised form gets diagnosed and rolled back. No updated_at
-- and no update grant, because an audit trail you can edit is not one.
create table share_link_events (
  id uuid primary key default gen_random_uuid(),
  share_link_id uuid not null references share_links (id) on delete cascade,
  token_id uuid references share_link_tokens (id) on delete set null,
  kind share_link_event_kind not null,
  group_key text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint share_link_events_payload_is_object_ck
    check (jsonb_typeof(payload) = 'object')
);

create index share_link_events_share_created_idx
  on share_link_events (share_link_id, created_at desc);
-- The rate limit in share_respond() is exactly this index.
create index share_link_events_token_created_idx
  on share_link_events (token_id, created_at desc);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
--
-- Owner-only, everywhere. `anon` gets no policy and no grant on any of these
-- five tables: anonymous access is the two functions in 0041 and nothing else.
-- A policy admitting anon when a token matched would be inherited by every
-- future query on the table, and the next join would get the exemption free.

alter table share_links enable row level security;
alter table share_link_tokens enable row level security;
alter table share_link_items enable row level security;
alter table share_link_responses enable row level security;
alter table share_link_events enable row level security;

grant select, insert, update, delete on share_links to authenticated;
grant select, insert, update, delete on share_link_tokens to authenticated;
grant select, insert, update, delete on share_link_items to authenticated;
grant select, insert, update, delete on share_link_responses to authenticated;
-- Append-only: no update, no delete. Events go away with their share.
grant select, insert on share_link_events to authenticated;

create policy share_links_select on share_links for select to authenticated
  using (user_id = (select auth.uid()));
create policy share_links_insert on share_links for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy share_links_update on share_links for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy share_links_delete on share_links for delete to authenticated
  using (user_id = (select auth.uid()));

-- The four child tables all authorize through the parent share. Written out
-- rather than factored into a helper because a security definer helper here
-- would be one more thing that can be called directly, and the planner folds
-- these into the same index lookup either way.
create policy share_link_tokens_select on share_link_tokens for select to authenticated
  using (exists (select 1 from share_links s
                  where s.id = share_link_id and s.user_id = (select auth.uid())));
create policy share_link_tokens_insert on share_link_tokens for insert to authenticated
  with check (exists (select 1 from share_links s
                       where s.id = share_link_id and s.user_id = (select auth.uid())));
create policy share_link_tokens_update on share_link_tokens for update to authenticated
  using (exists (select 1 from share_links s
                  where s.id = share_link_id and s.user_id = (select auth.uid())))
  with check (exists (select 1 from share_links s
                       where s.id = share_link_id and s.user_id = (select auth.uid())));
create policy share_link_tokens_delete on share_link_tokens for delete to authenticated
  using (exists (select 1 from share_links s
                  where s.id = share_link_id and s.user_id = (select auth.uid())));

-- Adding an item checks both ends: the share is mine, and so is the subject.
-- Without the second half, "send to form" would be a way to put someone else's
-- inventory row on my own page.
create policy share_link_items_select on share_link_items for select to authenticated
  using (exists (select 1 from share_links s
                  where s.id = share_link_id and s.user_id = (select auth.uid())));
create policy share_link_items_insert on share_link_items for insert to authenticated
  with check (
    exists (select 1 from share_links s
             where s.id = share_link_id and s.user_id = (select auth.uid()))
    and (
      subject_type <> 'inventory_item'
      or exists (select 1 from inventory_items i
                  where i.id = subject_id and i.user_id = (select auth.uid()))
    )
  );
create policy share_link_items_update on share_link_items for update to authenticated
  using (exists (select 1 from share_links s
                  where s.id = share_link_id and s.user_id = (select auth.uid())))
  with check (exists (select 1 from share_links s
                       where s.id = share_link_id and s.user_id = (select auth.uid())));
create policy share_link_items_delete on share_link_items for delete to authenticated
  using (exists (select 1 from share_links s
                  where s.id = share_link_id and s.user_id = (select auth.uid())));

create policy share_link_responses_select on share_link_responses for select to authenticated
  using (exists (select 1 from share_links s
                  where s.id = share_link_id and s.user_id = (select auth.uid())));
create policy share_link_responses_insert on share_link_responses for insert to authenticated
  with check (exists (select 1 from share_links s
                       where s.id = share_link_id and s.user_id = (select auth.uid())));
create policy share_link_responses_update on share_link_responses for update to authenticated
  using (exists (select 1 from share_links s
                  where s.id = share_link_id and s.user_id = (select auth.uid())))
  with check (exists (select 1 from share_links s
                       where s.id = share_link_id and s.user_id = (select auth.uid())));
create policy share_link_responses_delete on share_link_responses for delete to authenticated
  using (exists (select 1 from share_links s
                  where s.id = share_link_id and s.user_id = (select auth.uid())));

create policy share_link_events_select on share_link_events for select to authenticated
  using (exists (select 1 from share_links s
                  where s.id = share_link_id and s.user_id = (select auth.uid())));
create policy share_link_events_insert on share_link_events for insert to authenticated
  with check (exists (select 1 from share_links s
                       where s.id = share_link_id and s.user_id = (select auth.uid())));
