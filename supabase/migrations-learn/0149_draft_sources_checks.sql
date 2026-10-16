-- A topic drafted from sources, with its checks kept, and no uncited row
-- approved (docs/LEARN-LEVELS-SPEC.md, "Drafting a topic"; plan #2138.11).
--
--   topics.drafting
--       what the topic was drafted from and the checks a draft alone can
--       give: the sources and performances the person named, coverage of
--       the sources, structure, the overlap between the two drafts, and the
--       practitioner checklist. Null for a topic drafted before sources or
--       written any other way. Provenance is not kept here: it is read from
--       each row's source and canonicality, so marking a row personal shows
--       at once.
--
--   topics_cited_on_approve
--       a draft becomes approved only when the topic, every level up to its
--       ceiling and every link from those levels either names a source or is
--       marked personal. learn 0145 left this rule to the code; this holds it
--       for every writer, the service role included. It fires only on the
--       move from draft to approved, so topics approved before it, and rows
--       written approved by the move from the claims graph, are untouched.

set search_path = learn, public, extensions;

alter table learn.topics add column if not exists drafting jsonb;

alter table learn.topics add constraint topics_drafting_ck
  check (drafting is null or jsonb_typeof(drafting) = 'object');

comment on column learn.topics.drafting is
  'What the topic was drafted from and the checks shown before approval: sources, performances, coverage, structure, overlap between two drafts, practitioner checklist (plan #2138.11). Null when drafted without.';

create or replace function learn.topics_cited_on_approve()
returns trigger
language plpgsql
security definer
set search_path = learn, public, pg_temp
as $$
declare
  uncited integer;
begin
  select
    (case when new.source is null and new.canonicality is distinct from 'personal' then 1 else 0 end)
    + (select count(*) from learn.topic_cells c
        where c.topic_id = new.id and c.level <= new.ceiling
          and c.source is null and c.canonicality is distinct from 'personal')
    + (select count(*) from learn.cell_links l
        join learn.topic_cells c on c.id = l.requiring_cell_id
        where c.topic_id = new.id and c.level <= new.ceiling
          and l.source is null and l.canonicality is distinct from 'personal')
  into uncited;

  if uncited > 0 then
    raise exception 'topic % has % uncited rows: name a source or mark each personal before approving', new.id, uncited
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function learn.topics_cited_on_approve() from public, anon, authenticated;

create trigger topics_cited_on_approve
  before update of status on learn.topics
  for each row
  when (old.status = 'draft' and new.status = 'approved')
  execute function learn.topics_cited_on_approve();
