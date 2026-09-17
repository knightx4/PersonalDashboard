-- Move the concepts marked known off a multiple-choice answer down to
-- recognised.
--
-- The second half of plan #401, and what #392 chose when it added the state:
-- the ideas already sitting at known because four options were on the screen
-- did not become better understood when the rule changed, so they read as what
-- was actually shown about them. A separate file from 0018 because Postgres
-- refuses a new enum value in the transaction that created it.
--
-- Only rows established by testing. `declared` is you saying you know it and
-- `inferred` is something above it having been answered, and neither is a
-- multiple-choice answer about this concept -- what those two are worth is a
-- question the basis column already answers on every screen.
--
-- A concept that has passed an applied case stays known. The applied rung
-- shipped before this one, so a few of them exist, and demoting a right written
-- answer would be this migration undoing the thing it is here to reward.

set search_path = learn, public, extensions;

update learn.concept_state as cs
set state = 'recognised'
where cs.state = 'known'
  and cs.established = 'tested'
  and not exists (
    select 1
    from learn.probes as p
    where p.concept_id = cs.concept_id
      and p.user_id = cs.user_id
      and p.rung <> 'recognise'
      and p.response_correct
  );
