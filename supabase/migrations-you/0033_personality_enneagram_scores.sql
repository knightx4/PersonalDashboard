-- Enneagram scores for every type, not only the top one.
--
-- Tests such as Truity's give a score for each of the nine types, and the
-- runner-up types say as much about a person as the top one. A typed-in
-- Enneagram result can now keep all nine.
--
-- you.personality_results.type_scores:
--   An array of nine numbers from 0 to 100, the score for types 1 to 9 in
--   order, as the person read them off their test. Null when they kept the
--   top type only, and always null for any kind other than 'enneagram'.

alter table you.personality_results
  add column if not exists type_scores jsonb;

alter table you.personality_results
  drop constraint if exists personality_results_type_scores_ck;

alter table you.personality_results
  add constraint personality_results_type_scores_ck
    check (
      type_scores is null
      or (
        kind = 'enneagram'
        and jsonb_typeof(type_scores) = 'array'
        and jsonb_array_length(type_scores) = 9
        and not jsonb_path_exists(
          type_scores,
          '$[*] ? (@.type() != "number" || @ < 0 || @ > 100)'
        )
      )
    );

comment on column you.personality_results.type_scores is
  'Enneagram only: the score for types 1 to 9 in order, each 0 to 100, or null when only the top type was kept.';
