-- Clear the SaaS metrics topic drafts so they are drafted again (plan #2247.15).
--
-- The 20 topics of the SaaS metrics territory were drafted on 16 October 2026
-- from pasted text. The draft run skips any topic whose `asked` is already on
-- a topic, so they have to go before it can write them again from the stored
-- Skok and a16z guides (the choice made on #2247.12, option a).
--
-- Only the owner's account is touched, and only
-- topics found by the territory's `asked` keys (lib/learn/levels/territories/
-- saas-metrics.ts). A topic is left alone when the owner has acted on it:
-- approved, no longer a draft, a cell rewritten or changed after it was drafted,
-- or any probe, evidence, claim, question or move review on its cells. The
-- cells, their links and the lens targets go with the topic through their
-- foreign keys. Topics left behind are listed in the notice, for the run note.

do $$
declare
  owner constant uuid := core.dev_owner_id();
  keys constant text[] := array[
    'Recurring revenue: MRR and ARR',
    'SaaS contracts: ACV and TCV',
    'Bookings, billings and revenue in SaaS',
    'SaaS revenue recognition and deferred revenue',
    'ARR bridge: new, expansion, contraction and churn',
    'Customer churn and revenue churn',
    'Net revenue retention and negative churn',
    'SaaS cohort analysis',
    'Predicting churn: customer health and NPS',
    'Gross margin in software',
    'Customer acquisition cost (CAC)',
    'Customer lifetime value (LTV)',
    'SaaS unit economics: LTV to CAC and CAC payback',
    'SaaS sales funnel metrics and sales capacity',
    'SaaS customer segmentation',
    'SaaS pricing, upsell and cross-sell',
    'SaaS growth rate',
    'Burn rate and the SaaS cash flow trough',
    'SaaS revenue forecasting',
    'SaaS metrics dashboard and benchmarks'
  ];
  kept text;
  removed int;
begin
  select string_agg(t.asked, '; ' order by t.asked) into kept
  from learn.topics t
  where t.user_id = owner
    and lower(btrim(t.asked)) in (select lower(btrim(k)) from unnest(keys) k)
    and not (
      t.status = 'draft' and t.approved_at is null
      and not exists (
        select 1 from learn.topic_cells c
        where c.topic_id = t.id and c.user_id = owner
          and (c.rewritten_at is not null or c.version > 1
               or c.updated_at - c.created_at > interval '5 seconds'
               or exists (select 1 from learn.probes x where x.cell_id = c.id)
               or exists (select 1 from learn.move_reviews x where x.cell_id = c.id)
               or exists (select 1 from learn.cell_evidence x where x.cell_id = c.id)
               or exists (select 1 from learn.cell_claims x where x.cell_id = c.id)
               or exists (select 1 from learn.cell_questions x where x.cell_id = c.id))
      )
    );

  delete from learn.topics t
  where t.user_id = owner
    and lower(btrim(t.asked)) in (select lower(btrim(k)) from unnest(keys) k)
    and t.status = 'draft' and t.approved_at is null
    and not exists (
      select 1 from learn.topic_cells c
      where c.topic_id = t.id and c.user_id = owner
        and (c.rewritten_at is not null or c.version > 1
             or c.updated_at - c.created_at > interval '5 seconds'
             or exists (select 1 from learn.probes x where x.cell_id = c.id)
             or exists (select 1 from learn.move_reviews x where x.cell_id = c.id)
             or exists (select 1 from learn.cell_evidence x where x.cell_id = c.id)
             or exists (select 1 from learn.cell_claims x where x.cell_id = c.id)
             or exists (select 1 from learn.cell_questions x where x.cell_id = c.id))
    );
  get diagnostics removed = row_count;

  raise notice 'SaaS metrics drafts removed: %; kept because acted on: %', removed, coalesce(kept, 'none');
end $$;
