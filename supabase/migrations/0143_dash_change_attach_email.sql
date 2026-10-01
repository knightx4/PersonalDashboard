-- Dash can attach an email to a task or a calendar event (todo 0016).
--
-- A fifth kind of change in core.dash_changes (0142): 'attach_email', whose
-- input names the Gmail message (mailbox and message id), the task or event
-- it goes on, and their titles for the card. Confirming it keeps the message
-- as an attachment, with its files, through lib/todo/attachments/email.ts;
-- undoing it takes the links back off. written_table is todo.attachments and
-- written_ref the email's attachment id.

set search_path = core, public, extensions;

alter table core.dash_changes drop constraint if exists dash_changes_kind_ck;
alter table core.dash_changes add constraint dash_changes_kind_ck
  check (kind in ('add_todo', 'add_goal_step', 'mark_returned', 'start_watch', 'attach_email'));
