-- Plan #2553.4: every project is built through the projects dispatcher, so a
-- project row no longer names a routine of its own. The website was the only
-- project that ever did, and its row held neither column (both null).
alter table public.dev_projects drop constraint if exists dev_projects_routine_env_ck;
alter table public.dev_projects drop column if exists routine_id_env;
alter table public.dev_projects drop column if exists routine_token_env;
