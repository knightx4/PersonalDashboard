-- A record that somebody looked at a module's interface, and what they found.
--
-- The mechanical half of the design laws runs on every push and its baseline
-- is at zero, which is why it can no longer say anything: a module in line and
-- a module nobody has opened since it shipped both report no violations. The
-- half a grep cannot see -- whether a surface says what it claims, whether it
-- shows enough of itself -- is a reading, and a reading is only worth having
-- if it is written down. Two rows: the pass, and what the pass found.
--
-- `module` is text and nullable-free rather than an enum or a foreign key, for
-- the same reason as `ideas.module` and `raised_items.module`: the list that
-- matters is lib/modules.ts, and a module renamed there should leave a
-- harmless string here rather than break the insert. It also holds 'shared',
-- which is what the gate calls the shell, the primitives and the account
-- pages -- they are somebody's to review too, and they belong to no workspace.
--
-- A pass with no findings is a real answer and a table with no row for a
-- module is a different one. Nothing here defaults a missing review to a clean
-- one: "never reviewed" is the absence of a row, and the page says so.
--
-- Findings are their own table rather than rows in feedback_items. The notes
-- queue is the one list read every morning, and twenty law-11 nits filed in a
-- single pass would bury the bug that lost data. These are worked from the
-- review page, next to the shot they came from.
--
-- `status` follows the decision that a session proposes and a person confirms:
-- a pass files findings as 'open', and each is confirmed or dismissed on the
-- page. Dismissed rows are kept rather than deleted -- what was looked at and
-- deliberately left alone is what stops the next pass filing the same nit.

set search_path = public, extensions;

create table if not exists ui_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Which module the pass was on, or 'shared'.
  module text not null,
  -- The commit the app was at when it was looked at, so a finding can be read
  -- against the code that produced it.
  commit_sha text,
  -- The mechanical count at the time, which is the other half of the picture
  -- and is a number that has to be recorded rather than recomputed: the gate
  -- reports today's files, and this pass looked at that day's.
  violations integer,
  -- What the pass looked at and deliberately left alone, in its own words.
  note text,
  created_at timestamptz not null default now(),
  constraint ui_reviews_module_length_ck check (length(btrim(module)) > 0 and length(module) <= 40),
  constraint ui_reviews_commit_sha_length_ck check (commit_sha is null or length(commit_sha) <= 40),
  constraint ui_reviews_violations_ck check (violations is null or violations >= 0),
  constraint ui_reviews_note_length_ck check (note is null or length(note) <= 4000)
);

-- The one query the page runs: the newest pass per module.
create index if not exists ui_reviews_user_module_created_idx
  on ui_reviews (user_id, module, created_at desc);

create table if not exists ui_findings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  review_id uuid not null references ui_reviews (id) on delete cascade,
  -- Where it is. `line` is null for something true of a whole file or of a
  -- surface rather than of one line.
  file text not null,
  line integer,
  -- Which law it breaks, as the number shown on /dev/ui.
  law text,
  -- The surface it was seen on, as an id from app/preview/surfaces.tsx, so the
  -- page can put the finding beside the shot it came from.
  surface text,
  -- What is out of line, and what to do instead.
  body text not null,
  status text not null default 'open',
  -- Why it was dismissed, or what was done about it.
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Set when you confirm or dismiss it. Null while it is a candidate.
  decided_at timestamptz,
  constraint ui_findings_file_not_blank_ck check (length(btrim(file)) > 0),
  constraint ui_findings_file_length_ck check (length(file) <= 300),
  constraint ui_findings_line_ck check (line is null or line > 0),
  constraint ui_findings_law_length_ck check (law is null or length(law) <= 40),
  constraint ui_findings_surface_length_ck check (surface is null or length(surface) <= 80),
  constraint ui_findings_body_not_blank_ck check (length(btrim(body)) > 0),
  constraint ui_findings_body_length_ck check (length(body) <= 4000),
  constraint ui_findings_note_length_ck check (note is null or length(note) <= 4000),
  constraint ui_findings_status_ck check (status in ('open', 'confirmed', 'dismissed'))
);

-- Under its pass, undecided first, then oldest first.
create index if not exists ui_findings_review_status_created_idx
  on ui_findings (review_id, status, created_at);

drop trigger if exists ui_findings_touch_updated_at on ui_findings;
create trigger ui_findings_touch_updated_at
  before update on ui_findings
  for each row execute function public.touch_updated_at();

alter table ui_reviews enable row level security;

drop policy if exists ui_reviews_select on ui_reviews;
create policy ui_reviews_select on ui_reviews for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists ui_reviews_insert on ui_reviews;
create policy ui_reviews_insert on ui_reviews for insert to authenticated
  with check (user_id = (select auth.uid()));
drop policy if exists ui_reviews_update on ui_reviews;
create policy ui_reviews_update on ui_reviews for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
drop policy if exists ui_reviews_delete on ui_reviews;
create policy ui_reviews_delete on ui_reviews for delete to authenticated
  using (user_id = (select auth.uid()));

alter table ui_findings enable row level security;

drop policy if exists ui_findings_select on ui_findings;
create policy ui_findings_select on ui_findings for select to authenticated
  using (user_id = (select auth.uid()));
-- The parent check is in the policy rather than in a trigger, as in
-- raised_comments: both tables are in `public` and the parent is readable
-- under the same policy, so a finding filed against somebody else's review
-- matches nothing and is refused.
drop policy if exists ui_findings_insert on ui_findings;
create policy ui_findings_insert on ui_findings for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from ui_reviews r
      where r.id = review_id and r.user_id = (select auth.uid())
    )
  );
drop policy if exists ui_findings_update on ui_findings;
create policy ui_findings_update on ui_findings for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
drop policy if exists ui_findings_delete on ui_findings;
create policy ui_findings_delete on ui_findings for delete to authenticated
  using (user_id = (select auth.uid()));

-- Said out loud rather than left to the project's default privileges, for the
-- reasons 0050 spells out: the grant is what makes this migration true on a
-- database rebuilt from the migrations alone, and the revoke is because those
-- same defaults hand every new table to `anon`.
grant select, insert, update, delete on ui_reviews to authenticated;
grant select, insert, update, delete on ui_findings to authenticated;

revoke all on table ui_reviews from anon;
revoke all on table ui_findings from anon;
