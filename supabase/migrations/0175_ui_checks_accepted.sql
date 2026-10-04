-- A screen the person let through after the critic's last round (plan #1610).
--
-- Decision #1535: when a surface fails its third round with the design
-- critic, the step blocks and the person decides. Accepting the screen as it
-- is writes one more round for each surface that stopped, with the verdict
-- `accepted`. The critic never writes it: it is the person's, and keeping it
-- apart from `pass` means the record still says who let the screen through.
-- The close guard (lib/plan/ui-check-guard.ts) counts it as passed.

set search_path = public, extensions;

alter table ui_checks drop constraint if exists ui_checks_verdict_ck;
alter table ui_checks
  add constraint ui_checks_verdict_ck check (verdict in ('pass', 'fix', 'accepted'));
