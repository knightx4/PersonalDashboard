-- ===========================================================================
-- What a goal is still waiting for, and the file that answered it
-- (plan #2778.7).
--
-- A goal's Work & files tab lists, under Waiting for, the documents its steps
-- still need: an approval letter, a receipt, a statement. Those come from
-- goals.document_kinds (migration 0056). Until now every kind belonged to a
-- form (a collection) and was what the form had learned to read. A step can
-- also simply wait for a document, with no form behind it, such as "Save the
-- IBR approval letter". So a kind may now belong to that step instead:
--
--   document_kinds.item_id        the step that waits for a document of this
--                                 kind. Null for a kind that belongs only to
--                                 a form, as every kind did before.
--   document_kinds.collection_id  now null for a kind that belongs only to a
--                                 step. A kind has one or the other, or both.
--
-- A kind is filled once a file of that kind is on the goal. The link from a
-- step to a file says which kind it is:
--
--   links.document_kind_id        on a 'file' link, the kind of document the
--                                 file is. Set when an upload or a Gmail
--                                 document is matched to a kind; null for
--                                 every other link. Archiving the kind
--                                 leaves the link and forgets the match.
--
-- Schema only: no existing row is changed.
-- ===========================================================================

alter table goals.document_kinds
  add column item_id uuid,
  alter column collection_id drop not null;

alter table goals.document_kinds
  add constraint document_kinds_item_fk foreign key (item_id, user_id)
    references goals.items (id, user_id) on delete cascade,
  add constraint document_kinds_owner_ck check (collection_id is not null or item_id is not null);

-- A step's own kinds are named once per step, as a form's are once per form.
create unique index document_kinds_item_name_key on goals.document_kinds (item_id, lower(btrim(name)))
  where archived_at is null and collection_id is null;

create index document_kinds_item_idx on goals.document_kinds (item_id) where item_id is not null;

alter table goals.links add column document_kind_id uuid;

alter table goals.links
  add constraint links_document_kind_fk foreign key (document_kind_id, user_id)
    references goals.document_kinds (id, user_id) on delete set null (document_kind_id),
  add constraint links_document_kind_ck check (document_kind_id is null or kind = 'file');

create index links_document_kind_idx on goals.links (document_kind_id)
  where document_kind_id is not null and archived_at is null;

comment on column goals.document_kinds.item_id is
  'The step that waits for a document of this kind, listed under Waiting for on its goal until a file of the kind is linked. Null for a kind that belongs only to a form.';
comment on column goals.links.document_kind_id is
  'On a file link: the kind of document the file is, which fills that kind under Waiting for. Null otherwise.';

notify pgrst, 'reload schema';
