-- Put back the dollar amounts that scripts/sql.ts wrote as NULL into four of
-- the owner's goal briefs before commit 3166862 (a "$2,450" was sent as
-- "NULL,450"). goals.briefs takes inserts only from the service role, so the
-- repair goes through a migration. Each figure comes from an intact copy: the
-- loan payoff schedule step ($204,384.62), the dresser and course files'
-- summaries, and the step the floor question asks about ($130,000). The one
-- figure with no intact copy, an example IBR payment at a given income, is
-- taken out of its sentence instead.
--
-- Scoped to the owner's account, row by row.

update goals.briefs
   set body = replace(body, '50" tall, NULL to NULL)', '50" tall, $147 to $170)')
 where user_id = core.dev_owner_id()
   and id = 'c8e89ce2-c28c-4490-84f7-ead81863409d';

update goals.briefs
   set body = replace(body, 'your NULL,000 floor', 'your $130,000 floor')
 where user_id = core.dev_owner_id()
   and id = '9805b57e-1e30-4fea-b9ff-f348a24b9240';

update goals.briefs
   set body = replace(replace(replace(body,
         'about NULL,450 a month', 'about $2,450 a month'),
         'on NULL,385.', 'on $204,385.'),
         'from NULL with none to about NULL at NULL,000, and', 'starting at $0 with none, and')
 where user_id = core.dev_owner_id()
   and id = '4e9d4c2a-539a-4e05-9572-1e3a92a5ae79';

update goals.briefs
   set body = replace(replace(body,
         'Baruch non-degree at NULL per credit', 'Baruch non-degree at $425 per credit'),
         'about NULL,335 to NULL,780 for three courses, against about NULL,000 per course',
         'about $4,335 to $5,780 for three courses, against about $8,000 per course')
 where user_id = core.dev_owner_id()
   and id = 'd21a05bb-ad6b-40aa-9213-b59dd417da70';
