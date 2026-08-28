-- Fields the "work the notes" loop needs.
--
-- A note moves open → in_progress → done. Two escapes exist because pretending
-- they do not is how a queue quietly rots: `blocked` for work that needs an
-- answer before it can proceed, and `declined` for work that will not happen.
-- Both require a reason, so the queue never contains a mystery.

set search_path = public, extensions;

alter type feedback_status add value if not exists 'in_progress';
alter type feedback_status add value if not exists 'blocked';
