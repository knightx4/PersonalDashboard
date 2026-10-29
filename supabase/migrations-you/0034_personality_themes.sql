-- Ranked themes, with what the report said about each, on a typed-in result.
--
-- A CliftonStrengths report is more than its five names: it puts each theme
-- in a domain, says how it shows up in this person, where it gets in the way
-- and how to use it. One line of typed_value cannot hold that, and Dash's
-- read is better for having it.
--
-- you.personality_results.themes:
--   An array of 1 to 34 themes in the test's order, strongest first. Each is
--   an object with a string `name`, and may carry:
--     domain       the group the test puts it in, such as "Strategic Thinking"
--     summary      the report's one line on the theme
--     score        how strongly it showed, 0 to 100, where the test measures it
--     insights     array of strings: what the report said about this person
--     blind_spots  array of strings: where it can get in the way
--     actions      array of strings: ways to use it
--   Null for a result kept as its line alone, and always null for a Big Five.

alter table you.personality_results
  add column if not exists themes jsonb;

alter table you.personality_results
  drop constraint if exists personality_results_themes_ck;

alter table you.personality_results
  add constraint personality_results_themes_ck
    check (
      themes is null
      or (
        kind <> 'big_five'
        and jsonb_typeof(themes) = 'array'
        and jsonb_array_length(themes) between 1 and 34
        and jsonb_array_length(jsonb_path_query_array(themes, '$[*].name ? (@.type() == "string")'))
          = jsonb_array_length(themes)
      )
    );

comment on column you.personality_results.themes is
  'Typed-in results only: the test''s themes strongest first, each {name, domain?, summary?, score?, insights?, blind_spots?, actions?}, or null.';
