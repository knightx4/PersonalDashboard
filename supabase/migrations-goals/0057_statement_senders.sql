-- ===========================================================================
-- Who sends each kind of document (plan #1023).
--
-- Each morning the goals run searches Gmail for new statements of the kinds
-- a collection has already learned, and updates the rows they name by ID. It
-- searches by sender, so a kind now keeps the senders its documents come
-- from.
--
--   document_kinds.senders  up to ten Gmail search terms for the sender, each
--                           an address ("noreply@edfinancial.com"), a domain
--                           ("edfinancial.com") or a name ("Edfinancial").
--                           Empty for a kind that does not arrive by email,
--                           such as an export downloaded from a website.
--
-- The run writes a sender when it reads a statement from Gmail, and the
-- person edits the list on the step with the rest of the kind.
-- ===========================================================================

-- A list of up to ten terms of up to 200 characters, none of them blank and
-- none carrying the quotes, brackets or braces that would break a search.
create or replace function goals.document_kind_senders_ok(senders jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(senders) = 'array'
     and jsonb_array_length(senders) <= 10
     and not exists (
       select 1 from jsonb_array_elements(senders) s
       where jsonb_typeof(s.value) <> 'string'
          or btrim(s.value #>> '{}') = ''
          or length(s.value #>> '{}') > 200
          or (s.value #>> '{}') ~ '["(){}]'
     );
$$;

revoke all on function goals.document_kind_senders_ok(jsonb) from public, anon;
grant execute on function goals.document_kind_senders_ok(jsonb) to authenticated, service_role;

alter table goals.document_kinds
  add column senders jsonb not null default '[]'::jsonb,
  add constraint document_kinds_senders_ck check (goals.document_kind_senders_ok(senders));

comment on column goals.document_kinds.senders is
  'Gmail search terms for who sends documents of this kind (an address, a domain or a name). The morning run searches for new mail from them and updates the collection''s rows by ID.';

notify pgrst, 'reload schema';
