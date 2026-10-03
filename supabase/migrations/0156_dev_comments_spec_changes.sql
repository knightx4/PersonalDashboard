-- Comments on a proposed spec change (plan #1507, docs/SPEC-LAYER-SPEC.md
-- part 3).
--
-- A spec change on /dev/specs gets the thread an idea has: a note to
-- yourself, a question for Dash with @dash, or a request to reword it, which
-- writes a new diff onto the same change. dev_comments names its target with
-- one nullable foreign key per kind of row (0062), so this adds a seventh,
-- cascading, so a change deleted takes its thread with it.
--
-- dev_comment_reads.target gains 'change', so opening a change's thread from
-- the conversations list can mark it read.

alter table public.dev_comments
  add column if not exists spec_change_id uuid
    references public.spec_changes (id) on delete cascade;

alter table public.dev_comments drop constraint if exists dev_comments_one_target_ck;
alter table public.dev_comments add constraint dev_comments_one_target_ck
  check (
    num_nonnulls(
      idea_id, plan_item_id, raised_item_id, feedback_item_id, spec_section_id,
      inspiration_takeaway_id, spec_change_id
    ) = 1
  );

create index if not exists dev_comments_spec_change_idx
  on public.dev_comments (spec_change_id, created_at) where spec_change_id is not null;

-- The check rewritten whole, as 0149 did, since the other six branches have to
-- survive it. Altered in place, so there is no moment without a policy.
alter policy dev_comments_insert on public.dev_comments
  with check (
    user_id = (select auth.uid())
    and (
      exists (
        select 1 from public.raised_items r
        where r.id = raised_item_id and r.user_id = (select auth.uid())
      )
      or exists (
        select 1 from public.ideas i
        where i.id = idea_id and i.user_id = (select auth.uid())
      )
      or exists (
        select 1 from public.plan_items p
        where p.id = plan_item_id and p.user_id = (select auth.uid())
      )
      or exists (
        select 1 from public.feedback_items f
        where f.id = feedback_item_id and f.user_id = (select auth.uid())
      )
      or exists (
        select 1 from public.spec_sections s
        where s.id = spec_section_id and s.user_id = (select auth.uid())
      )
      or exists (
        select 1 from public.inspiration_takeaways t
        where t.id = inspiration_takeaway_id and t.user_id = (select auth.uid())
      )
      or exists (
        select 1 from public.spec_changes c
        where c.id = spec_change_id and c.user_id = (select auth.uid())
      )
    )
  );

alter table public.dev_comment_reads drop constraint if exists dev_comment_reads_target_ck;
alter table public.dev_comment_reads add constraint dev_comment_reads_target_ck
  check (target in ('idea', 'step', 'raise', 'note', 'spec', 'takeaway', 'change'));
