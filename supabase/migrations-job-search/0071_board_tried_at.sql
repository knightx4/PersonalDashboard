-- When the daily board read last tried each followed company's board (plan
-- #2535.3), whether or not it loaded.
--
-- companies.board_read_at (0070) is set only when a board loads. A board that
-- fails every time would otherwise stay first in line and be tried again on
-- every ten-minute tick, so the reads are ordered and spaced by this instead:
-- each board is tried once a day, and one that fails waits for the next day
-- like the rest. The health check compares the two to see how many boards
-- stopped loading.

set search_path = job_search, extensions;

alter table companies add column if not exists board_tried_at timestamptz;

create index if not exists companies_board_tried_idx
  on companies (user_id, board_tried_at nulls first)
  where ats_board_token is not null;

notify pgrst, 'reload schema';
