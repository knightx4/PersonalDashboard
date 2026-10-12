-- Tie a reading_subjects row to its reading's owner (plan #1807, under #1805).
--
-- 0101 pointed reading_subjects.reading_id at learn.readings (id) alone. A
-- foreign key check passes no RLS, so another account could relate a subject
-- of its own to a reading it does not own by naming the reading's id. Making
-- the key (reading_id, user_id) against readings_user_id_uq means a row's
-- reading must belong to the row's own account, as its subject already must.

set search_path = learn, public, extensions;

alter table learn.reading_subjects drop constraint if exists reading_subjects_reading_id_fkey;
alter table learn.reading_subjects drop constraint if exists reading_subjects_reading_fk;
alter table learn.reading_subjects add constraint reading_subjects_reading_fk
  foreign key (reading_id, user_id) references learn.readings (id, user_id) on delete cascade;
