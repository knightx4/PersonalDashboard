-- Bring the existing review flags in line with lib/jobs/review/flagging.
--
-- The flag used to mean "a machine did this", which after six months of mail
-- meant 295 flagged pursuits, 501 flagged events and a badge reading 870. A
-- flag on everything carries no information. It now means "there is a decision
-- only you can make", and this migration re-decides the rows already written
-- under the old rule.
--
-- Nothing is deleted and no pursuit is hidden: clearing a flag only takes a
-- row out of the queue, and every one of them stays visible, searchable and
-- editable on the board exactly as before.

begin;

-- ---------------------------------------------------------------------------
-- 1. Seed events carry provenance, not a decision.
--
-- Every inferred pursuit was given a `submitted` event saying where it came
-- from, and that event was flagged as well as the application row. It asks
-- nothing, so it was pure duplication -- 282 of the 501.
-- ---------------------------------------------------------------------------
update job_search.application_events
set needs_review = false
where needs_review
  and kind = 'submitted'
  and source = 'system';

-- ---------------------------------------------------------------------------
-- 2. An echo is not a conflict.
--
-- A confirmation or a rejection arriving after a pursuit closed was flagged as
-- an unapplied transition. It is recorded for the timeline and decided by
-- nobody. Forward-moving mail on a closed pursuit stays flagged: either the
-- pursuit is not closed or the mail is misfiled, and both are worth a look.
-- ---------------------------------------------------------------------------
update job_search.application_events
set needs_review = false
where needs_review
  and kind in ('confirmation', 'rejection', 'note');

-- ---------------------------------------------------------------------------
-- 3. A ghosting is a guess by a clock, and mail overrules it.
--
-- `ghosted` is not a decision anybody made -- it is this app assuming silence
-- meant no. Where a rejection later arrived for a ghosted pursuit, the guess
-- has an answer, so the pursuit is rejected and the event is applied rather
-- than sitting in a queue.
-- ---------------------------------------------------------------------------
update job_search.applications a
set status = 'rejected',
    updated_at = now()
where a.status = 'ghosted'
  and exists (
    select 1
    from job_search.application_events e
    where e.application_id = a.id
      and e.kind = 'rejection'
  );

-- ---------------------------------------------------------------------------
-- 4. Pursuits the inbox opened on evidence that proves itself.
--
-- Nobody is rejected from, assessed for, or offered a job they never applied
-- to, and an ATS does not send a confirmation to someone who did not apply.
-- Those rows were never a judgement call. What stays flagged: leads (inbound
-- about a role with nothing on file -- whether it belongs in the pipeline is a
-- question about your intent), and anything a model decided on its own.
--
-- `link_confidence` is not consulted: it measures which *role* the mail
-- belongs to, and a wrong title is a detail on a visible row, not a reason to
-- hold the pursuit in a queue.
-- ---------------------------------------------------------------------------
--
-- Tier A is claimed exactly when the sender is a recognised hiring system or
-- its domain matches a company already on file (see classifyMessage), so that
-- is the condition below. The domain list is a snapshot of ats-senders.ts
-- taken when this migration was written -- it is a one-off repair of rows
-- already on disk, not a rule the app reads, and the rule itself lives in
-- lib/jobs/review/flagging.ts where new mail goes through it.
update job_search.applications a
set needs_review = false,
    updated_at = now()
where a.needs_review
  and exists (
    select 1
    from job_search.ingested_messages m
    join core.ingested_messages c on c.id = m.id
    where m.resulting_application_id = a.id
      and m.link_method like 'inferred=_from=_%' escape '='
      and m.classification in (
        'rejection', 'assessment', 'offer', 'application_confirmation'
      )
      and (
        -- A recognised hiring system.
        lower(coalesce(c.reply_to_address, c.from_address)) ~ (
          '@(.*\.)?(' ||
          'angel\.co|ashbyhq\.com|bamboohr\.com|breezy\.hr|greenhouse-mail\.io|' ||
          'greenhouse\.io|hirevue\.com|icims\.com|jobvite\.com|lever\.co|' ||
          'myworkday\.com|myworkdayjobs\.com|oraclecloud\.com|recruitee\.com|' ||
          'rippling\.com|smartrecruiters\.com|taleo\.net|wellfound\.com|' ||
          'workable\.com|workablemail\.com|workday\.com' ||
          ')'
        )
        -- Or a domain already on a company record, which is the other half of
        -- what makes a message deterministic.
        or exists (
          select 1
          from job_search.companies co, unnest(co.domains) as d
          where co.user_id = a.user_id
            -- `position`, not `like '%@'||d`: the stored address is a full
            -- header ("Kalshi Hiring Team <no-reply@ashbyhq.com>"), so the
            -- domain is rarely the last thing in the string.
            and position('@' || lower(d) in lower(coalesce(c.reply_to_address, c.from_address))) > 0
        )
      )
  );

commit;
