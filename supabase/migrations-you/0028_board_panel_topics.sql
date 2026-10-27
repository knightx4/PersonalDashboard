-- A topic for each panel, and the panel a meeting was held for (plan #2576.1,
-- under #2576).
--
-- board_panels.topic is one sentence on what the panel's meetings are about.
-- It is null on a panel the person made and has not described yet; the
-- board skill then asks the advisors about the panel's name alone.
--
-- A meeting kept for a panel remembers the panel as it was when it ran:
-- panel_name, panel_topic and panel_advisors (advisor keys, in the panel's
-- order) are copies, so editing or deleting the panel later does not rewrite
-- the minutes. panel_id is only a link back for the page and goes null when
-- the panel is deleted. All four are null on a meeting held for no panel.
--
-- Schema change, plus topics for the owner's four panels, three more panels
-- and the four guests they need, for the owner only. The new guests start
-- with brain_status 'none' so the brain routine builds them. No other
-- account's row is touched.

set search_path = you, public, extensions;

alter table you.board_panels
  add column topic text
    check (topic is null or (btrim(topic) <> '' and char_length(topic) <= 300));

comment on column you.board_panels.topic is
  'One sentence on what meetings held for this panel are about; null until the person or Dash writes one (plan #2576.1).';

alter table you.board_meetings
  add column panel_id uuid,
  add column panel_name text
    check (panel_name is null or (btrim(panel_name) <> '' and char_length(panel_name) <= 60)),
  add column panel_topic text
    check (panel_topic is null or char_length(panel_topic) <= 300),
  add column panel_advisors text[];

alter table you.board_meetings
  add constraint board_meetings_panel_fk
    foreign key (panel_id, user_id) references you.board_panels (id, user_id)
    on delete set null (panel_id),
  add constraint board_meetings_panel_ck
    check ((panel_name is null) = (panel_advisors is null)
      and (panel_id is null or panel_name is not null));

comment on column you.board_meetings.panel_id is
  'The panel this meeting was held for, while it still exists; the copies below are what the meeting used (plan #2576.1).';
comment on column you.board_meetings.panel_name is
  'The panel''s name when the meeting ran; null for a meeting held for no panel.';
comment on column you.board_meetings.panel_topic is
  'The panel''s topic when the meeting ran; null when the panel had none.';
comment on column you.board_meetings.panel_advisors is
  'The panel''s advisor keys when the meeting ran, in the panel''s order.';

-- Topics for the owner's four panels.
update you.board_panels p set topic = t.topic
from (values
  ('career', 'Work, the job search, skills and pay.'),
  ('money', 'Spending, saving, debt and income.'),
  ('life', 'Where and how they live, and their time; relationships only if they ask.'),
  ('building', 'Projects and the things they make.')
) as t (name, topic)
where p.user_id = 'd001bb0f-ffe8-4bfb-880f-17dd1a62b685'
  and lower(p.name) = t.name
  and p.topic is null;

-- The guests the three new panels need. Leonardo da Vinci and Benjamin
-- Franklin are already on the board.
insert into you.board_advisors (user_id, key, name, kind, question, focus, brain_status, added_by)
select u.id, g.key, g.name, 'guest', g.question, g.focus, 'none', 'person'
from auth.users u
cross join (values
  ('richard_feynman', 'Richard Feynman',
    'What would you notice if you tried to explain this to a beginner?',
    'Learning by explaining simply, curiosity for its own sake, and not fooling yourself.'),
  ('marcus_aurelius', 'Marcus Aurelius',
    'What is in your power here, and what is not?',
    'Duty, the discipline of attention, and separating what you control from what you do not.'),
  ('seneca', 'Seneca',
    'Are you spending your time as if it were the one thing you cannot get back?',
    'The shortness of time, wealth held lightly, and practising for hardship.'),
  ('socrates', 'Socrates',
    'What do you assume here that you have not examined?',
    'Questioning assumptions and living by examined reasons, as Plato and Xenophon recorded him.')
) as g (key, name, question, focus)
where u.id = 'd001bb0f-ffe8-4bfb-880f-17dd1a62b685'
on conflict (user_id, key) do nothing;

-- The three new panels.
insert into you.board_panels (user_id, name, topic, advisors)
select u.id, p.name, p.topic, p.advisors
from auth.users u
cross join (values
  ('Learning', 'What to learn and how.',
    array['richard_feynman', 'franklin', 'da_vinci', 'mentor']),
  ('Philosophy', 'How they want to live and think.',
    array['marcus_aurelius', 'seneca', 'socrates', 'skeptic', 'dreamer']),
  ('Hobbies', 'Music, art and what they do for its own sake.',
    array['da_vinci', 'richard_feynman', 'dreamer', 'cfo'])
) as p (name, topic, advisors)
where u.id = 'd001bb0f-ffe8-4bfb-880f-17dd1a62b685'
on conflict do nothing;

notify pgrst, 'reload schema';
