-- What the publisher offered for unsubscribing, kept with the issue it arrived
-- on.
--
-- Planned as #613, under #607. Senders put this in the List-Unsubscribe header,
-- and the inbound service hands the app every header it received, so the
-- header is only readable at delivery. Keeping it on the issue is what lets a
-- newsletter you open weeks later still show the button.
--
-- Two columns rather than one, because the header offers two different things
-- and the app does two different things with them. A link is opened in a new
-- tab. An address is written to, by the app through Mailgun, from the address
-- that subscribed (#615). A single column would mean every reader of it
-- deciding which kind it holds.
--
-- Numbered 0003: #613 was written when 0001 was the only file here, and 0002
-- had been added by then to expose the schema to PostgREST.
--
-- Both are null on every row already in the table, and null on anything that
-- arrives without the header. A publisher may offer both, either, or neither.
-- Nothing is backfilled: the headers of messages already delivered were not
-- kept, so there is nothing to backfill from.
--
-- Row level security on news.issues is a policy over the whole row
-- (`issues_all` in 0001), so it covers these columns as it stands and no policy
-- changes.

alter table news.issues
  -- The https link the publisher offered, stored as it appeared in the header.
  -- 2048 is the length past which browsers and proxies start disagreeing about
  -- what they will accept, and no real unsubscribe link is near it.
  add column unsubscribe_url text,

  -- The address to write to, with any subject the header asked for kept on the
  -- end of it: `list-x@example.com?subject=unsubscribe`. The header spells this
  -- as a mailto: URI; the scheme is dropped on the way in because nothing here
  -- opens it as a URI, and the sender that will send the mail wants the address
  -- and the subject separately.
  add column unsubscribe_email text;

alter table news.issues
  add constraint issues_unsubscribe_url_ck check (
    unsubscribe_url is null
    or (
      (unsubscribe_url like 'https://%' or unsubscribe_url like 'http://%')
      and length(unsubscribe_url) <= 2048
    )
  ),

  add constraint issues_unsubscribe_email_ck check (
    unsubscribe_email is null
    or (
      btrim(unsubscribe_email) = unsubscribe_email
      -- The scheme belongs to the header, not to the stored value. A row that
      -- kept it would send mail to an address beginning "mailto:".
      and unsubscribe_email not like 'mailto:%'
      and position('@' in unsubscribe_email) > 1
      and length(unsubscribe_email) between 3 and 998
    )
  );
