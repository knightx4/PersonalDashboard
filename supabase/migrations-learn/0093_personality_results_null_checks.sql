-- Close the gap that let a personality result through half written (plan #1631).
--
-- In 0092 the two shape checks on learn.personality_results come out null,
-- not false, when a column they test is null: a Myers-Briggs row with no
-- typed_value, or a Big Five row missing a score. Postgres lets a null check
-- pass, so those rows were accepted. Each check is now wrapped in
-- coalesce(…, false), so a missing value is refused. The table was empty when
-- this ran.

set search_path = learn, public, extensions;

alter table learn.personality_results
  drop constraint if exists personality_results_shape_ck,
  drop constraint if exists personality_results_read_ck;

alter table learn.personality_results
  add constraint personality_results_shape_ck
    check (coalesce(
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
      ),
      false
    )),
  add constraint personality_results_read_ck
    check (coalesce(
      (read_points is null and read_model is null and read_at is null)
      or (jsonb_typeof(read_points) = 'array' and read_model is not null and read_at is not null),
      false
    ));
