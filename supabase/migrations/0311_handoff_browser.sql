-- Browser tasks on session hand-offs (plan #3040.1, under #3040).
--
-- A bot can hand a session a request that needs a real browser: clicking
-- through a site, filling a form, reading a page that needs the person
-- signed in. The session drives Claude in Chrome when it can reach the
-- person's Chrome, and a headless Chromium otherwise (plan #3040.2).
-- docs/HANDOFF-BROWSER.md says where the sessions run and why the Chrome
-- route needs the person's machine.
--
--   browser_task    the bot marked the request as needing a browser
--                   (hand_off's `browser`). Set when the row is kept.
--   browser         the route the session used: chrome or headless. Null
--                   until the session picks one, and on a hand-off that
--                   needed no browser.
--   browser_reason  why that route, or why none could be used ("Chrome was
--                   not reachable and the page needs a sign-in"), in a
--                   sentence the bot can pass on.
--
-- Only a session hand-off carries them. No passwords or page contents are
-- kept here.
--
-- Schema change only: no account's rows are written.

set search_path = core, public, extensions;

alter table core.dash_handoffs
  add column browser_task boolean not null default false,
  add column browser text,
  add column browser_reason text;

alter table core.dash_handoffs
  add constraint dash_handoffs_browser_ck check (browser is null or browser in ('chrome', 'headless')),
  add constraint dash_handoffs_browser_reason_ck check (
    browser_reason is null or (btrim(browser_reason) <> '' and char_length(browser_reason) <= 500)
  ),
  add constraint dash_handoffs_browser_kind_ck check (
    kind = 'session' or (not browser_task and browser is null and browser_reason is null)
  );

comment on column core.dash_handoffs.browser_task is
  'The bot marked this session hand-off as needing a web browser (plan #3040.1).';
comment on column core.dash_handoffs.browser is
  'The browser the session used: chrome (Claude in Chrome, with the person''s sign-ins) or headless (a Chromium with none). Null until chosen.';
comment on column core.dash_handoffs.browser_reason is
  'Why the session took that browser, or why it could use none, in a sentence the bot can pass on.';
