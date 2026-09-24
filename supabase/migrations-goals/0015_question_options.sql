-- ===========================================================================
-- A question from Claude carries its options (plan #962).
--
-- docs/GOALS-SPEC.md, "Fuller maps": a question with fewer than two lettered
-- options is refused by the database. The first run on Pay off student debt
-- asked "Pay off highest-interest debt first, or smallest balance first?" with
-- an empty detail, so the page had no buttons to offer and the person had to
-- write the answer out.
--
-- goals.lettered_options(detail) counts the options the page would draw as
-- buttons, reading the detail the way lib/plan/options.ts planOptions does:
-- one option per line, each opening with a letter and a marker ("A — ",
-- "A - ", "A -- ", "A) ", "A. ", "A: ", "(a) ", "[a] "), at least two, lettered
-- in order from A. Anything else counts as none.
--
-- The trigger holds Claude's writes to it (goals.actor = 'claude', as in
-- 0006): a question Claude adds, or a question whose detail or kind Claude
-- rewrites, needs two options or more. A question you write yourself on the
-- page is yours to phrase as you like, and questions already in the table are
-- left alone until Claude next rewrites one.
-- ===========================================================================

create or replace function goals.lettered_options(detail text)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
declare
  line text;
  found text[];
  letters text[] := '{}';
begin
  if detail is null then
    return 0;
  end if;
  for line in select regexp_split_to_table(detail, E'\n') loop
    found := regexp_match(
      btrim(line, E' \t\r'),
      '^(?:\(([A-Za-z])\)|\[([A-Za-z])\]|([A-Za-z])[).:]|([A-Za-z])\s*(?:[—–]|-{1,2}))\s+\S'
    );
    if found is not null then
      letters := letters || lower(coalesce(found[1], found[2], found[3], found[4]));
    end if;
  end loop;
  if cardinality(letters) < 2 then
    return 0;
  end if;
  for i in 1 .. cardinality(letters) loop
    if letters[i] <> chr(96 + i) then
      return 0;
    end if;
  end loop;
  return cardinality(letters);
end;
$$;

grant execute on function goals.lettered_options(text) to authenticated, service_role;

create or replace function goals.items_question_options_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(goals.request_value('goals.actor', 'x-goals-actor'), '') <> 'claude' then
    return new;
  end if;
  if new.kind is distinct from 'decision' then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and new.detail is not distinct from old.detail
     and old.kind = 'decision' then
    return new;
  end if;
  if goals.lettered_options(new.detail) < 2 then
    raise exception 'A question needs at least two options in its detail, one per line, lettered from A: "A — …", then "B — …".'
      using errcode = 'check_violation', constraint = 'items_question_options';
  end if;
  return new;
end;
$$;

revoke all on function goals.items_question_options_guard() from public, anon, authenticated;

create trigger items_question_options_guard before insert or update on goals.items
  for each row execute function goals.items_question_options_guard();
