-- Which of a person's map ideas are due a score from Jev, and the clock that
-- scores them (plan #2947.3).
--
-- An idea is due when it has no row in obsidian.position_scores, when its row
-- was scored under another rubric, or when what Jev would read about it may
-- have changed: its statement or basis, a quote added or moved by a merge, or
-- a source note edited, renamed, moved or given another voice. That last test
-- is `source_sig`, an md5 over those fields with each note's blob_sha standing
-- in for its body, so finding what is due never reads a note's text. The job
-- then works out the exact input hash for each due idea and asks Jev only
-- when that hash differs from the stored one; when it does not, it writes the
-- new signature alone.
--
-- Only ideas the person holds or the map generated, with at least one live
-- source note that is not clipped, reference or secret (position_voices,
-- 0038), are scored. No account's rows are read or changed here.
--
-- The clock is a pg_cron job calling /api/cron/idea-scores every ten minutes,
-- the same way 0094 calls the map sweep, with the app_origin and cron_secret
-- Vault entries 0078 already requires. A call with nothing due costs one query
-- per account with Jev turned on. Guarded on the extensions so the local test
-- database, which has neither, still resets.

set search_path = obsidian, public, extensions;

alter table obsidian.position_scores add column source_sig text;

comment on column obsidian.position_scores.source_sig is
  'obsidian.idea_score_due''s signature of the idea and its source notes when the row was last checked; a different one makes the idea due again (plan #2947.3).';

create function obsidian.idea_score_due(
  p_user_id uuid,
  p_rubric_version text,
  p_limit int default 50
)
returns table (
  position_id uuid,
  source_sig text,
  scored boolean
)
language sql
stable
security invoker
set search_path = obsidian, extensions, pg_temp
as $$
  with eligible as (
    select p.id, p.statement, p.basis
      from obsidian.positions p
      join obsidian.position_voices v on v.position_id = p.id and v.user_id = p_user_id
     where p.user_id = p_user_id
       and p.stance in ('held', 'generated')
       and v.notes - v.clipped_notes - v.reference_notes - v.secret_notes > 0
  ),
  signed as (
    select e.id,
           md5(
             e.statement || chr(1) || coalesce(e.basis, '') || chr(1) ||
             coalesce(string_agg(
               ps.note_id::text || chr(2) || ps.quote || chr(2) || n.path || chr(2) ||
                 n.title || chr(2) || coalesce(n.voice::text, '') || chr(2) || n.blob_sha,
               chr(3) order by ps.note_id, ps.quote
             ), '')
           ) as sig
      from eligible e
      join obsidian.position_sources ps on ps.position_id = e.id and ps.user_id = p_user_id
      join obsidian.notes n on n.id = ps.note_id and n.user_id = p_user_id and n.deleted_at is null
     group by e.id, e.statement, e.basis
  )
  select s.id, s.sig, sc.id is not null
    from signed s
    left join obsidian.position_scores sc on sc.position_id = s.id and sc.user_id = p_user_id
   where sc.id is null
      or sc.rubric_version <> p_rubric_version
      or sc.source_sig is distinct from s.sig
   order by sc.id is not null, s.id
   limit greatest(p_limit, 0)
$$;

comment on function obsidian.idea_score_due(uuid, text, int) is
  'Up to p_limit of a person''s map ideas with no score, an older rubric''s, or sources changed since the last check, unscored first (plan #2947.3).';

revoke all on function obsidian.idea_score_due(uuid, text, int) from public, anon, authenticated;
grant execute on function obsidian.idea_score_due(uuid, text, int) to service_role;

do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron')
     or not exists (select 1 from pg_available_extensions where name = 'pg_net')
  then
    raise notice
      'pg_cron/pg_net not available here -- skipping the idea score schedule. Expected on the local test database.';
    return;
  end if;

  execute 'create extension if not exists pg_cron';
  execute 'create extension if not exists pg_net';

  execute $unschedule$
    select cron.unschedule(jobid) from cron.job where jobname = 'vault-idea-scores'
  $unschedule$;

  execute $schedule$
    select cron.schedule(
      'vault-idea-scores',
      '3-59/10 * * * *',
      $job$
        select net.http_post(
          url := (
            select decrypted_secret from vault.decrypted_secrets where name = 'app_origin'
          ) || '/api/cron/idea-scores',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || (
              select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret'
            )
          ),
          body := '{}'::jsonb,
          timeout_milliseconds := 295000
        )
      $job$
    )
  $schedule$;
end;
$$;
