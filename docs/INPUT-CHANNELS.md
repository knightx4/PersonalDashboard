# Adding things from outside the app

Research for plan #1659: the ways something could be added to the app
without opening it, what each could add, what it could not, and what it
would need. Written 7 October 2026 against main as it stood then. Nothing
here is built; the question of which to prototype first is decision #1678 on
/dev/plan.

## What the app already has

Five pieces already exist, and most of the channels below reuse them.

- **The capture box** (plan #1581, `app/capture-actions.ts`,
  `lib/capture/`). It takes free text, asks a model which of four places it
  belongs in (to-do, goals, job search, vault), and files it there. Every
  filing is recorded as a Dash action, so Home lists it with an Undo. It
  only runs as a server action, so it can only be called by someone signed
  in through the browser.
- **Mail into the app** (`app/api/news/inbound/route.ts`,
  `lib/news/address.ts`). Mailgun receives mail on the app's own domain
  (`NEWS_MAIL_DOMAIN`) and posts each message to the app, signed with an
  HMAC that is checked before anything is read. Each account has its own
  random address, and the address is the only thing that says whose a
  message is. Today it is used for newsletters only.
- **The Gmail sync** (`inngest/core/inbox-sync`, `lib/core/inbox/`). It reads
  the connected Gmail account with a read-only grant and offers every message
  to six linkers: orders (commerce), job applications, recurring payments,
  appointments, replies owed and the mailroom. Orders and rejections that
  reach Gmail are already filed without anybody forwarding them. It polls
  once a day, from the daily cron, or when the person presses sync.
- **The job bookmarklet** (`public/bookmarklet.js`,
  `app/api/jobs/capture/route.ts`, offered on the job search settings page).
  It sends the job posting open in the browser to the job search, using the
  browser's sign-in. It files job postings only.
- **The Claude connector** (`app/api/mcp/route.ts`, `lib/connector/`). Claude
  apps call it with a bearer token from Supabase's OAuth server. The token
  can only read.

What does not exist: any way for something other than a signed-in browser to
write. Every channel below that is not email needs that first.

## The shared piece: a capture endpoint

One route, `POST /api/capture`, that takes `{ text, url?, place? }` and runs
the same sort-and-file the capture box does. With `place` set it files
straight there and skips the model.

It would be authenticated by a personal capture token:

- made on the account page, shown once, stored only as a hash;
- able to file a capture and nothing else, so a leaked token can add rows
  but cannot read any;
- listed with when it was last used, and revocable;
- rate-limited, because each unsorted capture is one paid model call.

This is about one sitting of work: a table, the route, the account-page
section, and tests. Siri, the Watch, the iPhone share sheet, Zapier, IFTTT
and a browser extension would all call it, so it is the first thing to build
whichever of those is chosen.

## The channels

### Siri Shortcuts

**Could add:** anything said or typed. "Hey Siri, add to Dash" asks for the
text, posts it, and speaks back where it went ("Filed under to-do: renew the
passport"). A second Shortcut can pin the place, such as "Add to shopping
list". The same Shortcut, set to show in the share sheet, takes a link or
selected text from Safari or any other app, which covers the iPhone share
sheet as well.

**Could not:** show the sorting chips before filing. The capture goes where
the model puts it, and a wrong guess is fixed with the Undo on Home.
Anything that needs a back-and-forth, such as choosing which goal a step
belongs to, is past what a Shortcut does well.

**Would need:** the capture endpoint and a token. The Shortcut itself is a
"Get Contents of URL" action with the token in a header, shared as an iCloud
link the person installs once and pastes the token into. No App Store, no
developer account.

### Apple Watch quick-add

**Could add:** the same as Siri. Shortcuts run on the Watch (watchOS 7 and
later), so the Siri Shortcut above works from the wrist with dictation and
can be put on a watch face as a complication.

**Could not:** anything visual. There is no list to look at on the Watch
this way, only the spoken reply.

**Would need:** nothing beyond the Siri Shortcut. A native Watch app would
mean a Swift project, a paid Apple developer account and App Store review,
for the same result. Not worth it unless the Watch has to show something.

### Email forwarding

**Could add:** a receipt from an account Gmail sync does not read (a work
address, iCloud mail), a message the order linker missed, or an article or
booking to keep. Forwarded to an address of the person's own, it would be
filed the way the Gmail sync files the same kind of message: an order to
shopping, a rejection to the job search, anything else to the vault or
to-do through the capture sorter. Variants of the address could pin the
place, such as `<address>+todo@`.

**Could not:** help much with Gmail mail, which is already read, except to
file one message now rather than at the next daily sync. A forwarded
message also puts the original sender, date and subject inside the body, so
the linkers would need to read the forwarded header out of it rather than
the envelope. Attachments, such as PDF receipts, would need their own
parsing.

**Would need:** a second address per account (or a plus-address on the
existing one), a Mailgun route that sends it to a new endpoint, and a check
that the message came from one of the person's own addresses, so a stranger
who learns the address cannot file things. No token and no app. Of the five,
this needs the least new infrastructure, because the signed delivery is
already in place.

### Browser extension or share-sheet action

**Could add:** the page being read, with its title and any selected text,
to the vault, to Learn's reading, or a product page to the shopping saved
list.

**Could not:** read a page behind a login unless an extension sends the
text itself. A bookmarklet or share target sends only the address and the
title.

**Would need:** depends on the device.

- **Android:** a `share_target` entry in the web app manifest
  (`app/manifest.ts`) and a `/share` page that opens the capture box filled
  in. The installed app is already signed in, so no token is needed. Small.
- **iPhone:** Safari does not support web share targets, so the share sheet
  on iOS goes through the Siri Shortcut above.
- **Desktop:** the job bookmarklet already shows the pattern works here. A
  general one that opens `/share?url=…&title=…` in a small window, using the
  browser's existing sign-in, needs no install and no token, and would take
  any page rather than job postings only. A real Chrome extension could send selected text and work from a
  keyboard shortcut, but needs a token, a Chrome Web Store listing (a one-off
  $5 developer fee) and review on each update. The bookmarklet covers most of
  it first.

### Zapier or IFTTT webhooks

**Could add:** whatever another service those tools connect to produces: a
starred email, a new calendar event, a liked video, a reading-app highlight,
a form response. Each one becomes a capture, with `place` set by the Zap so
nothing is guessed.

**Could not:** anything two-way; the app cannot answer back into the other
service. The data also passes through a third party on its way in.

**Would need:** the capture endpoint and a token. On the person's side,
Zapier's "Webhooks by Zapier" and IFTTT's webhooks both sit on paid plans as
of this writing, so this channel costs money every month even though the app
side is the same endpoint the Shortcut uses.

## Comparison

| Channel | New on the app side | Needs on the person's side | Rough size |
|---|---|---|---|
| Siri Shortcut | Capture endpoint and token | Install a shared Shortcut | Medium (the endpoint), small after |
| Apple Watch | Nothing beyond the Shortcut | The same Shortcut | None extra |
| Email forwarding | Second address, Mailgun route, sender check, forwarded-header parsing | Forward a message | Medium |
| Android share sheet | Manifest entry and a `/share` page | Install the app | Small |
| Desktop bookmarklet | The same `/share` page | Drag a link to the toolbar | Small |
| Chrome extension | Extension, token | Install it | Medium, plus store review |
| Zapier or IFTTT | Nothing beyond the endpoint | A paid plan and a Zap | None extra |

## Recommendation

Build the capture endpoint and the Siri Shortcut first. That one piece of
work also gives the Watch and the iPhone share sheet, and leaves Zapier and
an extension needing nothing more from the app. Email forwarding is the
better second choice than first, because Gmail sync already files most of
what forwarding would be used for.
