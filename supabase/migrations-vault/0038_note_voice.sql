-- Whose words each vault note is (plan #2413.3, under #2413).
--
-- An insight run read every note as what the person believes. The vault mixes
-- their own thinking with pages copied from elsewhere (Bulk/Bulk - Wiki,
-- Resources), course summaries, and writing meant to persuade somebody (job
-- applications, cover letters, MBA essays), so a position argued in an
-- application read as a belief. Each note now carries a voice:
--
--   private    written for themselves: journals, ideas, thinking
--   audience   written for somebody else to read: an application, an essay,
--              a cover letter, a résumé, interview answers
--   clipped    mostly someone else's words: a wiki page, a web clip, quotes,
--              a book summary kept in Resources
--   reference  a record kept to look things up: a course summary, a
--              template, a drawing, instructions for an agent
--   secret     holds passwords, keys or other credentials. Never read by an
--              insight run, never embedded for memory search
--
-- Rules decide first, in SQL (obsidian.voice_by_rule), so a credential note is
-- tagged secret before any model sees it. What no rule decides is read by one
-- Haiku call per note version (lib/vault/notes/voice.ts, from the map sweep's
-- tick). A note is due again when its blob or its path changes, since moving a
-- note out of Pending is how this vault files it.
--
-- The voice columns are left out of notes_touch_updated_at's column list
-- (vault 0037), so tagging a note does not move updated_at: the Maya gate
-- reads updated_at as "the text changed" and would re-read the whole vault.

set search_path = obsidian, public, extensions;

create type obsidian.note_voice as enum ('private', 'audience', 'clipped', 'reference', 'secret');

alter table obsidian.notes
  add column voice obsidian.note_voice,
  add column voice_reason text,
  add column voice_by text,
  add column voice_blob_sha text,
  add column voice_path text,
  add constraint notes_voice_reason_ck
    check ((voice is null) = (voice_reason is null) and (voice_reason is null or voice_reason <> '')),
  add constraint notes_voice_by_ck
    check ((voice is null) = (voice_by is null) and (voice_by is null or voice_by in ('rule', 'model')));

comment on column obsidian.notes.voice is
  'Whose words the note is: private, audience, clipped, reference, or secret for credentials (plan #2413.3).';
comment on column obsidian.notes.voice_reason is
  'One sentence on why the note has its voice, shown to the person.';
comment on column obsidian.notes.voice_by is
  'What set the voice: rule (obsidian.voice_by_rule) or model (one Haiku call).';
comment on column obsidian.notes.voice_blob_sha is
  'The blob the voice was read from.';
comment on column obsidian.notes.voice_path is
  'The path the voice was read at; a move makes the note due again.';

alter table obsidian.notes
  add column voice_due boolean
  generated always as (
    voice is null
    or voice_blob_sha is distinct from blob_sha
    or voice_path is distinct from path
  ) stored;

comment on column obsidian.notes.voice_due is
  'True while the note has no voice, or its blob or path changed since it was tagged.';

create index notes_voice_due_idx
  on obsidian.notes (user_id, id)
  where deleted_at is null and voice_due;

create index notes_user_voice_idx
  on obsidian.notes (user_id, voice)
  where deleted_at is null;

-- ---------------------------------------------------------------------------
-- Credentials. The title says so, or the body holds a "password: …" line or a
-- key in a provider's shape. On 18 October 2026 this matched Me/Passwords.md
-- by its title and ten coding-project notes holding API keys.
-- ---------------------------------------------------------------------------
create or replace function obsidian.note_holds_secret(p_path text, p_title text, p_body text)
returns boolean
language sql
immutable
parallel safe
set search_path = pg_catalog, pg_temp
as $$
  select coalesce(p_title, '') ~* '\m(passwords?|passcodes?|passphrases?|credentials?|logins?|2fa|recovery codes?|api keys?)\M'
      or coalesce(p_path, '') ~* '(^|/)[^/]*\m(passwords?|passcodes?|passphrases?|credentials?|logins?)\M[^/]*$'
      or coalesce(p_body, '') ~* '(?n)^[[:space:]>*+-]*(password|passcode|passphrase|pw|pwd|pin)[[:space:]]*[:=][[:space:]]*[^[:space:]]'
      or coalesce(p_body, '') ~ '(-----BEGIN [A-Z ]*PRIVATE KEY-----|\mAKIA[0-9A-Z]{16}\M|\msk-(ant-|proj-)?[A-Za-z0-9_-]{20,}|\mgh[pousr]_[A-Za-z0-9]{30,}|\mgithub_pat_[A-Za-z0-9_]{20,}|\mxox[abprs]-[A-Za-z0-9-]{10,})'
$$;

comment on function obsidian.note_holds_secret(text, text, text) is
  'Whether a note holds credentials, by its title or path, a password line, or a key in a known shape (plan #2413.3).';

-- ---------------------------------------------------------------------------
-- The folder rules, in order; the first that matches decides. No row means the
-- model decides.
-- ---------------------------------------------------------------------------
create or replace function obsidian.voice_by_rule(
  p_path text,
  p_title text,
  p_body text,
  p_frontmatter jsonb
)
returns table (voice obsidian.note_voice, reason text)
language sql
immutable
parallel safe
set search_path = pg_catalog, pg_temp
as $$
  select r.voice, r.reason
    from (values
      (1, obsidian.note_holds_secret(p_path, p_title, p_body),
       'secret'::obsidian.note_voice, 'Holds passwords, keys or other credentials.'),
      (2, p_path ~* '(^|/)templates/',
       'reference', 'A template, kept to start other notes from.'),
      (3, p_path ~* '(^|/)(claude|agents)\.md$',
       'reference', 'Instructions for an AI agent working in the vault.'),
      (4, p_path ~* '(^excalidraw/|\.excalidraw(\.md)?$)',
       'reference', 'A drawing.'),
      (5, p_path ~* '^bulk/bulk - wiki/',
       'clipped', 'In Bulk - Wiki, where pages copied or summarised from elsewhere are kept.'),
      (6, p_path ~* '^(bulk/)?resources/',
       'clipped', 'In Resources, where books, quotes, poems and other outside material are kept.'),
      (7, p_path ~* '^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}/',
       'clipped', 'Clipped from a website, filed under its address.'),
      (8, coalesce(p_frontmatter->>'source', '') ~* '^https?://',
       'clipped', 'Clipped from the web: its front matter names the page it came from.'),
      (9, p_path ~* '^career/job applications/',
       'audience', 'In Career/Job Applications: written for an employer to read.'),
      (10, p_path ~* '^essays/',
       'audience', 'In Essays: written for somebody else to read.'),
      (11, coalesce(p_frontmatter->'tags', '[]'::jsonb) ? 'application',
       'audience', 'Tagged application: written for somebody else to read.'),
      (12, coalesce(p_title, '') || ' ' || regexp_replace(coalesce(p_path, ''), '^.*/', '')
             ~* '\m(application|cover letter|personal statement|recommendation letter|resume|résumé|cv|take home|talking points|interview prep|work experience form)\M',
       'audience', 'Titled as an application, a letter or interview answers: written for somebody else to read.'),
      (13, p_path ~* '^yale/course summaries/',
       'reference', 'A course summary: what a class taught rather than what you think of it.'),
      (14, obsidian.note_prose_chars(coalesce(p_body, '')) < 20,
       'private', 'Too short to be anybody else''s words.')
    ) as r(rank, hit, voice, reason)
   where r.hit
   order by r.rank
   limit 1
$$;

comment on function obsidian.voice_by_rule(text, text, text, jsonb) is
  'The voice the folder and credential rules give a note, or no row when the model decides (plan #2413.3).';

-- ---------------------------------------------------------------------------
-- Tag every due note a rule decides. Null means every account's notes, which
-- only the service role can see; a session names the owner.
-- ---------------------------------------------------------------------------
create or replace function obsidian.tag_voice_by_rule(p_user_id uuid default null)
returns int
language sql
security invoker
set search_path = pg_catalog, pg_temp
as $$
  with tagged as (
    update obsidian.notes n
       set voice = rule.voice,
           voice_reason = rule.reason,
           voice_by = 'rule',
           voice_blob_sha = n.blob_sha,
           voice_path = n.path
      from obsidian.notes due
      cross join lateral obsidian.voice_by_rule(due.path, due.title, due.body, due.frontmatter) rule
     where n.id = due.id
       and due.deleted_at is null
       and due.voice_due
       and (p_user_id is null or due.user_id = p_user_id)
    returning 1
  )
  select count(*)::int from tagged
$$;

comment on function obsidian.tag_voice_by_rule(uuid) is
  'Sets the voice of every due note a rule decides, returning how many (plan #2413.3).';

-- The due notes no rule decides, for the model, in id order after p_after_id.
create or replace function obsidian.voice_due_notes(
  p_user_id uuid default null,
  p_after_id uuid default null,
  p_limit int default 50
)
returns table (
  id uuid,
  user_id uuid,
  path text,
  title text,
  body text,
  frontmatter jsonb,
  blob_sha text
)
language sql
stable
security invoker
set search_path = pg_catalog, pg_temp
as $$
  select n.id, n.user_id, n.path, n.title, left(n.body, 4000), n.frontmatter, n.blob_sha
    from obsidian.notes n
   where n.deleted_at is null
     and n.voice_due
     and (p_user_id is null or n.user_id = p_user_id)
     and (p_after_id is null or n.id > p_after_id)
     and not obsidian.note_holds_secret(n.path, n.title, n.body)
     and not exists (
       select 1 from obsidian.voice_by_rule(n.path, n.title, n.body, n.frontmatter)
     )
   order by n.id
   limit greatest(p_limit, 0)
$$;

comment on function obsidian.voice_due_notes(uuid, uuid, int) is
  'Due notes no rule decides, with the first 4,000 characters of the body, for the voice model (plan #2413.3).';

revoke all on function obsidian.tag_voice_by_rule(uuid) from public, anon;
revoke all on function obsidian.voice_due_notes(uuid, uuid, int) from public, anon;
grant execute on function obsidian.tag_voice_by_rule(uuid) to authenticated, service_role;
grant execute on function obsidian.voice_due_notes(uuid, uuid, int) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- What a run may read. Every live note but the secret ones: tagged secret, or
-- not yet tagged and caught by the credential rule.
-- ---------------------------------------------------------------------------
create or replace view obsidian.readable_notes
with (security_invoker = true)
as
  select n.*
    from obsidian.notes n
   where n.deleted_at is null
     and n.voice is distinct from 'secret'
     and not (n.voice_due and obsidian.note_holds_secret(n.path, n.title, n.body));

comment on view obsidian.readable_notes is
  'Live notes an insight run or any reader may read: every note but those holding credentials (plan #2413.3).';

-- ---------------------------------------------------------------------------
-- Whose words each position stands on: its source notes counted by voice, so
-- a run can ask which beliefs appear only in writing for an audience.
-- ---------------------------------------------------------------------------
create or replace view obsidian.position_voices
with (security_invoker = true)
as
  select ps.user_id,
         ps.position_id,
         count(distinct ps.note_id)::int as notes,
         (count(distinct ps.note_id) filter (where n.voice = 'private'))::int as private_notes,
         (count(distinct ps.note_id) filter (where n.voice = 'audience'))::int as audience_notes,
         (count(distinct ps.note_id) filter (where n.voice = 'clipped'))::int as clipped_notes,
         (count(distinct ps.note_id) filter (where n.voice = 'reference'))::int as reference_notes,
         (count(distinct ps.note_id) filter (where n.voice = 'secret'))::int as secret_notes,
         (count(distinct ps.note_id) filter (where n.voice is null))::int as untagged_notes,
         -- An untagged note is not yet known to be for an audience, so it
         -- counts against: bool_and alone would skip its null.
         coalesce(bool_and(n.voice is not distinct from 'audience'), false) as only_for_audience
    from obsidian.position_sources ps
    join obsidian.notes n on n.id = ps.note_id and n.user_id = ps.user_id
   where n.deleted_at is null
   group by ps.user_id, ps.position_id;

comment on view obsidian.position_voices is
  'Each position''s live source notes counted by voice; only_for_audience when every one was written for somebody else (plan #2413.3).';

revoke all on obsidian.readable_notes, obsidian.position_voices from public, anon;
grant select on obsidian.readable_notes, obsidian.position_voices to authenticated, service_role;
