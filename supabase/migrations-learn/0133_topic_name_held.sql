-- A name alone does not light a topic (plan #2172.1).
--
-- A city named once in a travel note lit that city as something you know.
-- From now on a name match counts only where the source's vector is at least
-- 0.5 close to the topic's, or two different documents name the topic. A name
-- match that does neither is still kept as a row, with matched_by 'name', so
-- the run can show what it found and why it did not count; held_reason says
-- why, and topic state does not read a row that has one.
--
-- Null held_reason is a link that counts, which is every link already there
-- and every link to an idea. The next daily run sets it on the name links
-- that fail the rule.

set search_path = learn, public, extensions;

alter table learn.evidence_links add column if not exists held_reason text;

comment on column learn.evidence_links.held_reason is
  'Set on a link to a topic that was found by name but does not count: the source''s vector is under 0.5 close to the topic and no second document names it (plan #2172.1). Topic state ignores a link with a reason. Null for a link that counts.';
