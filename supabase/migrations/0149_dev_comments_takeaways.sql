-- Comments on inspiration takeaways (notes c934aefe and eef7e9f1).
--
-- The Inspiration tab's takeaways get the same thread an idea has: a note to
-- yourself, or a question for Dash with @dash. dev_comments names its target
-- with one nullable foreign key per kind of row (0062), so this adds a sixth,
-- cascading, so a takeaway removed by a re-read takes its thread with it.
--
-- dev_comment_reads.target gains 'takeaway', so opening a takeaway's thread
-- from the conversations list can mark it read. It gains 'spec' too, which
-- 0087 added as a comment target but never allowed here, so a spec thread
-- could not be marked read.

alter table public.dev_comments
  add column if not exists inspiration_takeaway_id uuid
    references public.inspiration_takeaways (id) on delete cascade;

alter table public.dev_comments drop constraint if exists dev_comments_one_target_ck;
alter table public.dev_comments add constraint dev_comments_one_target_ck
  check (
    num_nonnulls(
      idea_id, plan_item_id, raised_item_id, feedback_item_id, spec_section_id, inspiration_takeaway_id
    ) = 1
  );

create index if not exists dev_comments_inspiration_takeaway_idx
  on public.dev_comments (inspiration_takeaway_id, created_at) where inspiration_takeaway_id is not null;

-- The check rewritten whole, as 0087 did, since it is replaced rather than
-- extended and the other five branches have to survive it. Altered in place
-- rather than dropped and created, so there is no moment without a policy.
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
    )
  );

alter table public.dev_comment_reads drop constraint if exists dev_comment_reads_target_ck;
alter table public.dev_comment_reads add constraint dev_comment_reads_target_ck
  check (target in ('idea', 'step', 'raise', 'note', 'spec', 'takeaway'));
