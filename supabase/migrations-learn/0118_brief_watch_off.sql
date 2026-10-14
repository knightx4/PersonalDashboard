-- Briefs are not watched for new sources unless the person turns it on
-- (decision #2023.7, answered "No watch by default, but has an option").
--
-- learn.briefs.watch_on now defaults to false, and any brief made before
-- this goes to false with it. When this was written the table had no rows.

set search_path = learn, public, extensions;

alter table learn.briefs alter column watch_on set default false;

update learn.briefs set watch_on = false where watch_on;
