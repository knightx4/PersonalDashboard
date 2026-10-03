-- What Dash finds wrong with a spec, and the change it proposes to the spec
-- (plan #1505, docs/SPEC-LAYER-SPEC.md parts 2 and 3).
--
-- The weekly spec audit reads a spec and the code it covers and writes one
-- spec_findings row per thing it found: the spec holds, the code drifted from
-- it, the spec describes something not built, code no spec covers, or a rule
-- the notes keep asking for. A finding that proposes a change drafts a
-- spec_changes row, which the person approves or declines on /dev/specs.
--
-- A change carries its diff to the spec's markdown and nothing else of the
-- spec: docs/ stays the source of truth, as 0087 says, and an approved change
-- reaches it as a commit. The diff is capped at 60 changed lines so the
-- person can read it on a phone; a larger change is split. The cap is a check
-- here rather than in the code that writes it, so a session writing through
-- the connector meets it too. lib/specs/changes.ts counts the same way.
--
-- A session writes both, so neither is a source for Goals (lib/dev/sources.ts).

set search_path = public, extensions;

-- ------------------------------------------------------- counting a diff

-- The lines a unified diff adds or removes. File headers (`diff --git`,
-- `index`, `--- a/…` and `+++ b/…`) are not changes, and neither is anything
-- before the first `@@` hunk header, so a header is never counted against the
-- cap. A `--- ` line followed by a `+++ ` line starts a new file inside a
-- multi-file diff.
create or replace function public.spec_diff_changed_lines(p_diff text)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
declare
  lines text[] := string_to_array(replace(coalesce(p_diff, ''), E'\r', ''), E'\n');
  line text;
  in_hunk boolean := false;
  changed integer := 0;
  i integer;
begin
  for i in 1 .. coalesce(array_length(lines, 1), 0) loop
    line := lines[i];
    if line like 'diff %' then
      in_hunk := false;
    elsif line like '--- %' and i < array_length(lines, 1) and lines[i + 1] like '+++ %' then
      in_hunk := false;
    elsif line like '@@%' then
      in_hunk := true;
    elsif in_hunk and (left(line, 1) = '+' or left(line, 1) = '-') then
      changed := changed + 1;
    end if;
  end loop;
  return changed;
end;
$$;

revoke all on function public.spec_diff_changed_lines(text) from public, anon;
grant execute on function public.spec_diff_changed_lines(text) to authenticated, service_role;

-- ------------------------------------------------------------ spec_changes

create table if not exists spec_changes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- The spec's slug in lib/specs/registry.ts. A change that creates a spec
  -- names the slug it will have.
  spec text not null,
  -- What will be true afterwards, in about eight words.
  title text not null,
  -- Two to five sentences citing the findings, notes or page opens behind it.
  why text not null,
  -- The change to the spec's markdown, as a unified diff.
  diff text not null,
  -- proposed: waiting on the person. approved: they said yes and the routine
  -- has not committed it yet. declined: they said no. applied: the diff is in
  -- docs/ on main, at commit_sha.
  status text not null default 'proposed',
  -- Who drafted it: the person (asking Dash for one) or a session.
  made_by text not null default 'claude',
  -- The feature or overhaul it became, once shaped.
  plan_item_id uuid references plan_items (id) on delete set null,
  decided_at timestamptz,
  applied_at timestamptz,
  commit_sha text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint spec_changes_spec_not_blank_ck check (length(btrim(spec)) > 0),
  constraint spec_changes_title_ck check (length(btrim(title)) > 0 and length(title) <= 120),
  constraint spec_changes_why_ck check (length(btrim(why)) > 0 and length(why) <= 2000),
  constraint spec_changes_status_ck check (status in ('proposed', 'approved', 'declined', 'applied')),
  constraint spec_changes_made_by_ck check (made_by in ('me', 'claude')),
  -- At least one changed line, and no more than a phone can show.
  constraint spec_changes_diff_size_ck check (public.spec_diff_changed_lines(diff) between 1 and 60),
  constraint spec_changes_decided_ck check ((status = 'proposed') = (decided_at is null)),
  constraint spec_changes_applied_ck check ((status = 'applied') = (applied_at is not null))
);

-- What is waiting on the person, newest first, and a spec's history.
create index if not exists spec_changes_user_status_idx
  on spec_changes (user_id, status, created_at desc);
create index if not exists spec_changes_user_spec_idx
  on spec_changes (user_id, spec, created_at desc);
create index if not exists spec_changes_plan_item_idx
  on spec_changes (plan_item_id) where plan_item_id is not null;

create trigger spec_changes_touch_updated_at
  before update on spec_changes
  for each row execute function public.touch_updated_at();

alter table spec_changes enable row level security;

create policy spec_changes_select on spec_changes for select to authenticated
  using (user_id = (select auth.uid()));
create policy spec_changes_insert on spec_changes for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy spec_changes_update on spec_changes for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy spec_changes_delete on spec_changes for delete to authenticated
  using (user_id = (select auth.uid()));

grant select, insert, update, delete on spec_changes to authenticated;
revoke all on table spec_changes from anon;

-- ----------------------------------------------------------- spec_findings

create table if not exists spec_findings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- The spec's slug in the registry. For code no spec covers, the slug the
  -- proposed spec would have.
  spec text not null,
  -- The heading the finding is about, or null for the whole spec.
  section text,
  -- holds: the spec and code agree. drifted: the code does something else.
  -- missing: the spec describes something not built. undescribed: code no
  -- spec covers. missing_rule: notes keep asking for a rule (Part 5).
  kind text not null,
  -- What the audit found, in a sentence or two.
  finding text not null,
  -- File paths, counts, note ids, page opens.
  evidence text not null default '',
  -- change_code, change_spec or none. Either change drafts a spec change.
  proposal text not null default 'none',
  -- The change it led to, when there is one.
  spec_change_id uuid references spec_changes (id) on delete set null,
  -- The cse_ id of the session that ran the audit, when known.
  session_id text,
  created_at timestamptz not null default now(),
  constraint spec_findings_spec_not_blank_ck check (length(btrim(spec)) > 0),
  constraint spec_findings_kind_ck
    check (kind in ('holds', 'drifted', 'missing', 'undescribed', 'missing_rule')),
  constraint spec_findings_proposal_ck check (proposal in ('change_code', 'change_spec', 'none')),
  constraint spec_findings_finding_not_blank_ck check (length(btrim(finding)) > 0)
);

create index if not exists spec_findings_user_spec_idx
  on spec_findings (user_id, spec, created_at desc);
create index if not exists spec_findings_change_idx
  on spec_findings (spec_change_id) where spec_change_id is not null;

alter table spec_findings enable row level security;

create policy spec_findings_select on spec_findings for select to authenticated
  using (user_id = (select auth.uid()));
create policy spec_findings_insert on spec_findings for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy spec_findings_update on spec_findings for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy spec_findings_delete on spec_findings for delete to authenticated
  using (user_id = (select auth.uid()));

grant select, insert, update, delete on spec_findings to authenticated;
revoke all on table spec_findings from anon;
