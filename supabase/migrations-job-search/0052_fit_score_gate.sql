-- The lowest Jev fit score a recommended role may have and still be shown
-- (feature #1679, after its first week).
--
--   profiles.min_fit_score   0 to 100; 0 turns the gate off. 25 by default:
--                            on the first person's history every role they
--                            saved or applied to scored 27 or more, and the
--                            software engineering roles discovery suggested
--                            in error scored 2 to 22.
--
-- A role Jev scores below it comes off the list as an expired suggestion
-- with expired_reason 'low_fit', as a sure duplicate already does, so it is
-- kept and can be looked at, and is never counted as the person turning it
-- down. Roles from discovered startups are scored before they are written,
-- and one below the gate is never written at all.

set search_path = job_search, extensions;

alter table profiles add column if not exists min_fit_score smallint not null default 25;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_min_fit_score_ck') then
    alter table profiles add constraint profiles_min_fit_score_ck
      check (min_fit_score between 0 and 100);
  end if;
end $$;

alter table suggestions drop constraint if exists suggestions_expired_reason_ck;
alter table suggestions add constraint suggestions_expired_reason_ck
  check (expired_reason is null or expired_reason in ('closed', 'stale', 'duplicate', 'low_fit'));
