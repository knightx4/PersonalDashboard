-- Job descriptions, filled in from the company's own board.
--
-- A role created from an email has never had a job description: the ingestion
-- path writes a title and nothing else, and the fetcher was only ever wired to
-- the paste box on the role form. So the JD panel is empty on exactly the roles
-- nobody typed in by hand, which is most of them.
--
-- The backfill closes that by working a company at a time rather than a role at
-- a time -- one board call answers every role at that employer -- and these
-- columns are what let it run unattended: where the board was found, whether a
-- description came from a person or from a match, and why an attempt that found
-- nothing found nothing.

set search_path = job_search, extensions;

-- ---------------------------------------------------------------------------
-- Companies: what we know about where their board lives
-- ---------------------------------------------------------------------------

-- The ATS sending subdomain seen in mail -- `ramp.greenhouse.io` is `ramp`.
-- Deliberately NOT ats_board_token: that column means "proven", and this one
-- means "worth trying". Discovery promotes a hint to a token only once a board
-- has answered to it.
alter table companies add column if not exists ats_board_hint text;

-- When discovery last ran, so a company with no public board is retried on a
-- clock rather than on every sweep.
alter table companies add column if not exists ats_board_checked_at timestamptz;

-- ---------------------------------------------------------------------------
-- Roles: where the description came from, and what the last attempt did
-- ---------------------------------------------------------------------------

-- Two values, because there are two writers. Anything that reaches the role
-- form was read and submitted by a person, whether or not a URL fetch
-- pre-filled the box; `board_match` is the only description no human saw. A
-- third writer can add its own value in one line.
create type jd_source as enum ('manual', 'board_match');

-- Null for every row written before this migration. Backfilling it would be a
-- guess: a JD already on a role was pasted or fetched and there is nothing left
-- that says which, so the column starts honest and fills in going forward.
alter table roles add column if not exists jd_source jd_source;

alter table roles add column if not exists jd_lookup_at timestamptz;

-- Why the last automated attempt did not produce a description. Shown on the
-- role, because "no board found for this company" and "three postings matched
-- and I would not choose between them" ask for different things from you, and
-- an empty panel asks for nothing.
alter table roles add column if not exists jd_lookup_note text;

-- The backfill's own query: roles with no description, oldest attempt first.
-- Partial, because the rows it will never look at -- every role that already
-- has a JD -- are the overwhelming majority and grow without bound.
create index if not exists roles_jd_backfill_idx
  on roles (jd_lookup_at nulls first)
  where jd_text is null;
