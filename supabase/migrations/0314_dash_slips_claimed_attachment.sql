-- A bot that says it attached a file it never sent is a slip (plan #3050.1).
--
-- On 7 November 2026 Newt answered a request for a chart of the markets'
-- week with "Here's your chart, attached as stocks_week_nov6_2026.png!" and
-- nothing came: no bot can send a file into a People thread or Ask Dash yet.
-- A reply that claims an attachment when none was sent now gets a closing
-- text saying nothing came through, and is kept here as kind
-- 'claimed_attachment' so Dev Home counts it with the other slips.
--
-- Schema only: the kind check is widened, and no row is written or changed.

set search_path = core, public, extensions;

alter table core.dash_slips drop constraint dash_slips_kind_ck;
alter table core.dash_slips add constraint dash_slips_kind_ck
  check (kind in ('thin_step', 'repeated_step', 'out_of_budget', 'claimed_attachment'));
