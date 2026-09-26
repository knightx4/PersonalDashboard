-- What a newsletter issue is for, so Quick read can leave out the ones that
-- carry no news.
--
-- About a third of the issues summarised so far are not news at all: welcome
-- emails, subscription confirmations, verification codes, fundraising appeals,
-- invitations to the sender's own events and "we are live now" notices. Each
-- has no stories, so Quick read showed it as a whole-newsletter card.
--
-- The summariser now names the purpose of each issue it reads
-- (lib/news/issues/digest.ts). Quick read shows an issue whose purpose is
-- news, or not yet known; every other purpose is left out of it. The issue is
-- still in the newsletter list, where it can be opened as before.
--
-- Null means the issue was summarised before this column existed, or has not
-- been summarised. Those are shown, as they were.

set search_path = news, public, extensions;

alter table news.issues add column purpose text;

alter table news.issues add constraint issues_purpose_ck check (
  purpose is null
  or purpose in (
    'news',
    'welcome',
    'confirmation',
    'fundraising',
    'promotion',
    'notification'
  )
);

notify pgrst, 'reload schema';
