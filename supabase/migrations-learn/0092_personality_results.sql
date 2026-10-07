-- Personality test results, one row per test taken or typed in (plan #1631, under #1630).
--
-- A retake is a new row beside the earlier one, never an overwrite, so the
-- results read as a history by taken_at.
--
-- learn.personality_results:
--   kind            'big_five' for the 50-item IPIP Big Five taken in Learn
--                   (#1632); 'mbti', 'enneagram' or 'other' for a type the
--                   person got elsewhere and typed in (#1633).
--   test_name       what the result is called in a list: "Big Five", "Myers-
--                   Briggs", "Enneagram", or the person's own name for another
--                   test.
--   answers         big_five only: the 50 answers, 1 to 5, in the order of the
--                   IPIP item list, so a result can be scored again if the key
--                   is ever corrected. Null for a typed-in type.
--   extraversion, agreeableness, conscientiousness, emotional_stability,
--   intellect       big_five only: the five factor scores as the IPIP key
--                   gives them, the sum of ten items each scored 1 to 5 after
--                   reversing the minus-keyed ones, so 10 to 50. These are the
--                   IPIP's own factor names; emotional_stability is the
--                   opposite pole of neuroticism, and intellect is the IPIP's
--                   name for openness. Percentages are worked out on read.
--   typed_value     a typed-in type as written, such as "INTJ" or "5w4". Null
--                   for big_five.
--   taken_at        the day the test was taken, which for a typed-in result
--                   may be long before it was entered.
--   read_points,    Dash's read of the result against the person's notes
--   read_model,     (#1635): a JSON array of points, each saying where the
--   read_at         test agrees or clashes with what they wrote and naming the
--                   note it rests on; the model that wrote it; and when. It
--                   lives on the result because there is one read per result,
--                   written again in place when the person asks for a fresh
--                   one. All three are null until the first read.
--
-- The two shape checks let a null through here; 0093 tightens them.
--
-- Owner-only, like the other learn tables. It is what the person did and
-- said about themselves, so it is a source in lib/learn/sources.ts.

set search_path = learn, public, extensions;

create table if not exists learn.personality_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null,
  test_name text not null,
  answers jsonb,
  extraversion smallint,
  agreeableness smallint,
  conscientiousness smallint,
  emotional_stability smallint,
  intellect smallint,
  typed_value text,
  taken_at date not null default current_date,
  read_points jsonb,
  read_model text,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint personality_results_kind_ck
    check (kind in ('big_five', 'mbti', 'enneagram', 'other')),
  constraint personality_results_test_name_ck
    check (length(btrim(test_name)) between 1 and 120),
  constraint personality_results_shape_ck
    check (
      (
        kind = 'big_five'
        and jsonb_typeof(answers) = 'array'
        and jsonb_array_length(answers) = 50
        and extraversion between 10 and 50
        and agreeableness between 10 and 50
        and conscientiousness between 10 and 50
        and emotional_stability between 10 and 50
        and intellect between 10 and 50
        and typed_value is null
      )
      or (
        kind <> 'big_five'
        and answers is null
        and extraversion is null
        and agreeableness is null
        and conscientiousness is null
        and emotional_stability is null
        and intellect is null
        and length(btrim(typed_value)) between 1 and 60
      )
    ),
  constraint personality_results_read_ck
    check (
      (read_points is null and read_model is null and read_at is null)
      or (jsonb_typeof(read_points) = 'array' and read_model is not null and read_at is not null)
    )
);

create index if not exists personality_results_user_taken_idx
  on learn.personality_results (user_id, taken_at desc, created_at desc);

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'personality_results_touch'
      and tgrelid = 'learn.personality_results'::regclass
  ) then
    create trigger personality_results_touch
      before update on learn.personality_results
      for each row execute function learn.touch_updated_at();
  end if;
end;
$$;

alter table learn.personality_results enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'learn' and tablename = 'personality_results'
      and policyname = 'personality_results_all'
  ) then
    create policy personality_results_all on learn.personality_results for all to authenticated
      using (user_id = (select auth.uid()))
      with check (user_id = (select auth.uid()));
  end if;
end;
$$;

revoke all on learn.personality_results from anon, authenticated;
grant select, insert, update, delete on learn.personality_results to authenticated;
grant select, insert, update, delete on learn.personality_results to service_role;

comment on table learn.personality_results is
  'Personality test results, one row per test taken or typed in, with Dash''s read of each against '
  'the person''s notes (plan #1631).';
