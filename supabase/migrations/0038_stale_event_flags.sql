-- Make the derived event flag agree with the rule that documents it.
--
-- Two different rules were deciding one column. Ingestion applies
-- unappliedEventNeedsReview (lib/jobs/review/flagging.ts): only mail that would
-- *reopen* a pursuit -- an assessment, an interview, an offer, a recruiter
-- writing back -- means the app is probably wrong about the pursuit being over,
-- and that is the case worth one look. A second rejection, or a confirmation
-- arriving after the close, is an echo: recorded for the timeline, decided by
-- nobody.
--
-- sync_application_state disagreed. Folding the log forward, it flagged *every*
-- event that arrived after the pursuit closed, whatever kind it was. And since
-- that function is the column's owner and re-runs on every touch of the log, it
-- won: an event correctly left unflagged at ingestion was flagged again the
-- next time anything moved, and clearing one by hand -- or from the review
-- queue's own Acknowledge button -- lasted until the next fold. That is why the
-- queue kept a standing dozen "conflict" rows announcing that a confirmation
-- for a job you had already been rejected from had, indeed, arrived.
--
-- So the rule moves into a function both sides can name, and the fold now
-- *sets* the flag rather than only raising it -- the owner owning the column in
-- both directions, which is what lets a stale flag clear itself.
--
-- The `is distinct from` is load-bearing, not tidiness. This statement writes to
-- the table whose AFTER UPDATE trigger calls this function, so a write that
-- changes nothing still costs a full re-fold, and an unconditional write
-- recurses until the stack gives out. The original `and needs_review = false`
-- was what broke that cycle; only-write-on-change is the same guard, widened to
-- let the value fall as well as rise.
--
-- The fold is patched in place rather than restated. This function is long,
-- security definer, and the single owner of derived status; retyping it from
-- the repo would risk quietly reverting whatever is actually deployed. The
-- patch asserts its anchor is there and refuses rather than guessing.

begin;

create or replace function job_search.unapplied_event_needs_review(
  k job_search.application_event_kind
)
returns boolean
language sql
immutable
as $$
  -- REOPENS_A_PURSUIT in lib/jobs/review/flagging.ts, restated. Keep in step.
  select k in (
    'screen_scheduled',
    'assessment_sent',
    'interview_scheduled',
    'offer',
    'recruiter_reply'
  );
$$;

comment on function job_search.unapplied_event_needs_review(job_search.application_event_kind) is
  'Whether an event that could not be applied is worth your attention. Mirrors unappliedEventNeedsReview in lib/jobs/review/flagging.ts.';

do $patch$
declare
  def text;
  patched text;
begin
  select pg_get_functiondef(p.oid) into def
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'job_search' and p.proname = 'sync_application_state';

  if def is null then
    raise exception 'job_search.sync_application_state() not found';
  end if;

  patched := regexp_replace(
    def,
    'update application_events set needs_review = true\s+where id = v_event\.id and needs_review = false;',
    'update application_events set needs_review = job_search.unapplied_event_needs_review(v_kind)'
      || E'\n        where id = v_event.id'
      || E'\n          and needs_review is distinct from job_search.unapplied_event_needs_review(v_kind);'
  );

  if patched = def then
    raise exception
      'sync_application_state() no longer contains the flag-raising statement this migration patches; refusing to guess';
  end if;

  execute patched;
end
$patch$;

-- Recompute, rather than update the column by hand: it is derived, and the
-- fold above is what owns it. Every flag now standing was set by the old rule.
do $recompute$
declare
  v_id uuid;
begin
  for v_id in
    select distinct application_id from job_search.application_events where needs_review
  loop
    perform job_search.sync_application_state(v_id);
  end loop;
end
$recompute$;

commit;
