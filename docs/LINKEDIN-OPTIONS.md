# What LinkedIn offers this app for free

Written 15 October 2026 from LinkedIn's own developer documentation and legal
pages, fetched that day. Nothing here is connected: no LinkedIn app exists, no
key is set and nothing has been signed up for. This page lists what could be
connected so the next step can choose. Written to [WRITING-GUIDE.md](WRITING-GUIDE.md).

Where a claim could not be confirmed on a LinkedIn page, the page says so and
does not fill the gap.

## The short version

| Ability | Free | LinkedIn approves the app | Reads anything from LinkedIn |
| --- | --- | --- | --- |
| Sign in with LinkedIn (OpenID Connect) | Yes | No, self-serve | Your name, photo, email |
| Post as yourself (Share on LinkedIn) | Yes | No, self-serve | No |
| Download your data archive | Yes | Not an app | Yes, by hand, as files |
| Connections, messages, feed through an API | Not offered to a personal app | Partner programs only | Not available |

LinkedIn's own page on access says "Open Permissions are the only permissions
that are available to all developers without special approval", and lists
three: `profile` and `email` under Sign in with LinkedIn using OpenID Connect,
and `w_member_social` under Share on LinkedIn. Everything else on that page
needs approval or a partner program. Source:
[Getting Access to LinkedIn APIs](https://learn.microsoft.com/en-us/linkedin/shared/authentication/getting-access).

## 1. Sign in with LinkedIn (OpenID Connect)

- **Cost and approval.** Free. Self-serve: add the product "Sign in with
  LinkedIn using OpenID Connect" on the Products tab of an app in the
  [Developer Portal](https://www.linkedin.com/developers/). No LinkedIn review is
  described.
- **What it returns.** Scopes `openid`, `profile`, `email`. The userinfo
  response holds `sub` (an identifier), `name`, `given_name`, `family_name`,
  `picture`, `locale`, and optionally `email` and `email_verified`. The page says
  the email fields "may not be included in all responses".
- **What it cannot do.** It does not read connections, messages, the feed or
  the profile's positions and education. The page also says it "does not verify
  user identities and should not be marketed as such". The person URN that
  posting needs comes from this sign-in, per the Share on LinkedIn page.
- **Rate limits.** The page states none. Not confirmed. The general API terms
  set a default of 100,000 calls a day per application, "absent any use-quota
  restrictions" (clause 1.4(4) of the API terms below).
- **Source.** [Sign In with LinkedIn using OpenID Connect](https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/sign-in-with-linkedin-v2).
- **For this app.** The app already signs the person in with Supabase.
  LinkedIn sign-in would add a second way in and, with posting, supply the
  person URN. The page does not say whether a LinkedIn Company Page is needed
  to create an app for these two products. Not confirmed. The Member Data
  Portability product below does require one.

## 2. Posting as yourself (Share on LinkedIn)

- **Cost and approval.** Free. Self-serve: add the product "Share on LinkedIn",
  which grants `w_member_social`. No LinkedIn review is described.
- **What it can do.** Create a post as the signed-in member: text, a link
  (`ARTICLE`), an image or a video, with visibility `PUBLIC` or `CONNECTIONS`.
  The getting-access page also says `w_member_social` can "post, comment and
  like posts on behalf of an authenticated member". A successful post returns
  `201 Created` with the new post's id in the `X-RestLi-Id` header. Images and
  video are registered and uploaded first, in separate calls.
- **Rate limits.** Stated on the Share page: 150 requests a day per member and
  100,000 a day per application, counted in UTC. At one person, 150 a day is the
  limit that applies.
- **What it cannot do.** It does not list, read or measure the member's own
  posts. Reading posts, reactions and likes needs the restricted
  `r_member_social` permission. The search results used for this page describe
  it as granted to select developers only, but that came from a LinkedIn
  documentation snippet in a search result and not from a page fetched in full.
  Treat "a personal app cannot read its own posts' reactions" as likely and
  unconfirmed.
- **Source.** [Share on LinkedIn](https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/share-on-linkedin).
  That page is dated 2021 and last updated December 2023, and uses the older
  `ugcPosts` endpoint. LinkedIn may have a newer posts endpoint with other
  limits. Not checked.
- **Next to the X work.** [X-POSTS.md](X-POSTS.md) covers drafts that Dash
  writes and the person posts with a button on the Posts tab, with X's
  pay-per-use prices in the Post button's hint. LinkedIn posting would be the
  same shape with a different price: nothing per post is listed on the Share
  page, and the API terms say "LinkedIn currently does not charge a fee for use
  of the APIs, but may choose to in the future" (clause 8.2). The X voice rules
  (280 characters, no links) were written for X and would not carry over
  unchanged: the Share page states no length limit, and LinkedIn's limit was not
  confirmed.

## 3. Downloading your own data archive

This is a feature of the LinkedIn website, not an API and not an app.

- **Cost and approval.** Free, for the account owner, from a desktop browser:
  Me, Settings & Privacy, Data Privacy, "Download your data", then "Request
  archive".
- **What it contains.** Only the categories that apply to the account.
  LinkedIn groups them by speed. Within about ten minutes: Ad Targeting,
  Articles, Certifications, Education, Events, Job Applications, Positions,
  Profile, Skills. Within 48 hours: Connections, Messages, Logins, Comments,
  Shares, Reactions, Saved Items, Search Queries. The full archive arrives by
  email within 24 hours, and the download stays available for 72 hours.
- **What it leaves out.** "People You May Know" and "Who's Viewed Your
  Profile". Some connections have no email address, because members control
  whether theirs is shared. The page says the data is the member's own
  information only.
- **What it cannot do.** It is a snapshot taken when requested. Nothing updates
  on its own, and the page describes no way to schedule or automate a request.
  Whether the files are CSV or another format is not stated on that page, so the
  format is not confirmed here.
- **Rate limits.** Not stated.
- **Source.** [Download your LinkedIn data](https://www.linkedin.com/help/linkedin/answer/a1339364).
- **A programmatic version, for the EU only.** The Member Data Portability API
  (Member) lets a member's own app fetch that member's data. It is free to
  request, and the page says it is available "only for LinkedIn members located
  in the European Economic Area and Switzerland". The app must be created under
  a particular default Company Page that LinkedIn names, and it uses the scope
  `r_dma_portability_self_serve`. The Changelog API returns events from the last
  28 days only, and archiving starts at consent. Members elsewhere cannot
  consent to it. Rate limits are not stated there.
  Source: [Member Data Portability (Member)](https://learn.microsoft.com/en-us/linkedin/dma/member-data-portability/member-data-portability-member).
  The person's location was not checked here, so whether it applies to them is
  for them to say.

## 4. Connections, messages and the feed

**An API for these is not offered to a personal app.** The only open
permissions are the three in the table above, and none reads connections,
messages or the feed. The getting-access page lists what exists beyond them,
each needing approval or a partner program:

- Marketing (Advertising API): approval required.
- Sales Navigator Application Platform: partner approval, with a partner
  application.
- Talent (Recruiter System Connect, Apply Connect, Apply with LinkedIn, Premium
  Job Posting): partner application.
- Compliance (`r_compliance`, `w_compliance`): "Access is closed and may not be
  requested."

None of these is described as reading a member's own connections list, inbox or
feed. This page found no LinkedIn page that offers that to an individual.
Source: [Getting Access to LinkedIn APIs](https://learn.microsoft.com/en-us/linkedin/shared/authentication/getting-access).

The free routes to the same information are the archive in section 3
(Connections and Messages files, up to 48 hours) and, for EU members, the
portability API.

## Terms that forbid uses

- **Scraping and automation of the website.** The User Agreement section 8.2
  forbids software, scripts or robots "to scrape or copy the Services,
  including profiles and other data from the Services", and "bots or other
  unauthorized automated methods to access the Services, add or download
  contacts". A separate help page says LinkedIn does not permit crawlers, bots or
  browser plug-ins that scrape, modify or automate activity, and that accounts
  can be restricted. Sources:
  [User Agreement](https://www.linkedin.com/legal/user-agreement),
  [Prohibited software and extensions](https://www.linkedin.com/help/linkedin/answer/a1341387).
- **Scraping, in the API terms.** Clause 3.1(24) forbids "scraping, crawling,
  spidering or using any other technology or software to access LinkedIn content
  outside the APIs", including content obtained through a third party.
- **Keeping API data.** Clause 4.1 says not to "capture, copy, cache, or store
  any Content" beyond the time needed to provide the application's service to
  its users. Clause 3.1(7) forbids requesting more content than the application
  minimally needs, and clause 3.1(9) forbids using it for anything but letting
  users use it in the application. This bears on storing a signed-in member's
  profile in the app's database, and the terms were written for apps with many
  users. The terms have no clause about personal or internal use, so how they
  apply to a one-person app is not confirmed.
- **Sharing.** Clause 3.1(2) forbids giving the APIs, credentials or content to
  anyone but the company's employees (and contractors under conditions).
- **Limits and cost.** Clause 3.1(20) forbids trying to exceed or circumvent
  call limits. Clause 8.2 says LinkedIn charges nothing now and may later.
  Clause 11.3 lets LinkedIn suspend access "at any time for any reason".
- **Source for the API clauses.** [LinkedIn API Terms of Use](https://www.linkedin.com/legal/l/api-terms-of-use).
  Clause numbers were read from a summary of the page and should be checked
  against it before anything quotes them.

## What the Jobs workspace already does with LinkedIn

Nothing in the repository calls a LinkedIn API or reads a LinkedIn page. Every
use is a link, a stored URL or a rule about LinkedIn email.

- **Company and contact URLs.** `companies.linkedin_url` and `contacts.linkedin_url`
  hold a LinkedIn address the person types or pastes, shown as a link on the
  company page (`app/jobs/(app)/companies/[slug]/panels.tsx`), the contact
  page (`contacts/[id]/contact-detail.tsx`) and the contacts list. Company
  enrichment can fill a blank `linkedin_url` from a company website
  (`lib/jobs/enrich/company.ts`).
- **Outreach channels.** A contact touch has a channel of `linkedin_dm` or
  `linkedin_connect`. Dash drafts the message, and the person sends it on
  LinkedIn. Connection notes longer than LinkedIn's 300-character limit are
  dropped (`lib/jobs/suggest/payload.ts`). The Find page offers "Find on
  LinkedIn", a people search the person opens themselves (`linkedinSearchUrl`).
- **Roles from LinkedIn.** LinkedIn job pages are marked as blocking automated
  fetching, so the person pastes the description (`lib/jobs/ats/detect.ts`).
  A role's `source` can be `linkedin`.
- **LinkedIn email.** Easy Apply confirmations from `linkedin.com` are a
  recognised sender. InMail reply addresses are not treated as a person's email
  (`lib/jobs/contacts/from-mail.ts`), and the person can mark the domain as
  noise (`settings/sender-actions.ts`).
- **The stated rule.** [JOB-SEARCH-SPEC.md](JOB-SEARCH-SPEC.md) says "no
  LinkedIn scraping", and the privacy page says "The app does not read
  LinkedIn". Any option above that reads from LinkedIn changes that sentence on
  `app/(legal)/privacy/page.tsx` and needs a spec change.

Where an option overlaps with this:

- The archive's Connections file could fill contacts and company LinkedIn URLs
  that are now typed by hand, as an import the person runs.
- The archive's Messages and Job Applications files could back the touch log
  and the applications list, again as an import.
- LinkedIn sign-in gives a name, photo and email, which the app already has.
- Posting as yourself overlaps with the Posts tab only.

## What the next step needs to decide

1. Whether posting is wanted at all, given the 150 a day limit is no concern
   and the open question is cost, which LinkedIn lists as none today.
2. Whether a manual archive import, which needs no app and no terms review,
   covers the Jobs ideas better than any API route.
3. Whether the person is in the EEA or Switzerland, which decides if the
   portability API is open to them.
4. Whether to create a LinkedIn developer app, which is a signup and so a step
   the person approves.
