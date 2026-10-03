/**
 * The operations outside Learn that spend on a model call, by module.
 *
 * Learn keeps its own list in `lib/learn/spend.ts`, because it has most of the
 * calls and its comments are about Learn. This is the list for everything
 * else, written in one place for the same reason: the strings are what land in
 * `core.model_spend.operation`, the spend page groups by them, and the cost
 * hints read their estimates by them. Renaming one splits its history in two.
 *
 * Kebab case, naming what the call does rather than the function that makes it.
 */
export const SPEND_OPERATIONS = {
  jobs: [
    // Finding a company's homepage and what it does with a web search, from
    // the enrich button on a company's page. Haiku, up to three searches.
    'enrich-company',
    // Writing the interview prep note on a role's page. Opus.
    'write-interview-prep',
    // Reading a job email the rules could not place, during inbox ingest.
    // Haiku, one call per message that reaches it; background, no button.
    'classify-job-email',
    // Matching a posting's requirements against the evidence bank. Opus.
    'match-evidence',
    // Drafting an answer to an application question from the evidence bank.
    // Opus.
    'draft-answer',
    // Dash replying to a comment tagged @dash on a role, and writing the
    // cover letter when the comment asks for one (note 89ad8bef). Sonnet.
    'reply-to-role-comment',
    // Proposing evidence items from a pasted or uploaded source, on the
    // evidence settings page. Opus.
    'propose-evidence',
    // Suggesting learning tracks from the career goals entries, on the Career
    // goals page. Opus.
    'suggest-learning-tracks',
    // Finding people to meet for the work the person wants, with a web
    // search, and writing what to say to each. From the job suggestion cron
    // and the search button on Contacts. Sonnet, up to five searches and
    // two calls.
    'suggest-outreach',
    // Finding open postings worth applying for with a web search, from the
    // job suggestion cron (weekly) and the search button on Roles. Sonnet, up
    // to five searches and two calls.
    'find-openings',
    // Jev's ten questions about each recommended opening (plans #1178, #1202),
    // after the job suggestion cron and after the search button on Roles.
    // One request per opening.
    'score-openings',
    // Jev's fit and chance scores on each open application (plan #1203),
    // after the job suggestion cron. One request per application not yet
    // scored or whose role changed.
    'score-applications',
  ],
  shopping: [
    // Reading an order confirmation email into an order: from inbox ingest,
    // from reparsing confirmations, and from the review page's read button.
    // Haiku, one call per email.
    'extract-email-order',
    // Reading a subscription or bill email into a recurring payment, during
    // inbox ingest (plan #1125). Haiku, one call per email the rules claim;
    // background, no button.
    'read-bill-email',
    // Pricing an item for sale with a web search when no catalog knows it.
    // Haiku, up to two searches per item.
    'estimate-resale-price',
    // Reading the games on a shelf photo. Opus, one call per photo.
    'read-shelf-photo',
    // Reading a paper receipt photo into an order. Haiku.
    'read-receipt-photo',
    // Splitting a pasted list of books into titles and authors. Haiku, one
    // call per paste.
    'parse-paste-list',
    // Reading the books in a photo of spines or covers. Haiku.
    'read-book-photo',
  ],
  core: [
    // Dash answering a comment tagged @dash on a dev page, and under any row
    // whose thread has no reply of its own, a file first (plan #1441,
    // lib/thread/ask.ts). Sonnet since plan #1465.
    'reply-to-comment',
    // Suggesting plan steps from the daily dev digest. Haiku; background.
    'suggest-from-digest',
    // Dash answering a question asked from any page (plan #1089). Sonnet,
    // calling read tools until it answers: up to nine calls, each sending
    // the conversation and the lookups so far.
    'ask-dash',
    // The weekly observations across the modules (plan #1119). Sonnet, one
    // call per person a week, from the observations cron; background.
    'write-observations',
    // The year in review (plan #1121). Sonnet, one call per press of "Write
    // the review" on /timeline/year, and once a year per person from the
    // year review cron.
    'write-year-review',
    // The morning brief of the day (plan #1123). Haiku, one call per person
    // a day from the hourly day-brief cron, none on a quiet day; background.
    'write-day-brief',
    // Reading a booking confirmation, change or cancellation into an
    // appointment for the agenda, during inbox ingest (plan #1127). Haiku,
    // one call per email the rules claim; background, no button.
    'read-appointment-email',
    // A follow-up on a quiet application or a return request, written to
    // wait on the agenda (plan #1129). Sonnet, one call per draft, at most
    // six a person a morning from the hourly day-brief cron; background.
    'write-draft',
    // Sorting every ingested email into a pile, beside the linkers' rules
    // (plan #1173). Jev, one call per email; background, during inbox ingest.
    'sort-email',
    // Scoring what Dash writes against the writing guide (plan #1175). Jev,
    // six yes/no questions in one call per plan row a session writes or
    // comment reply Dash saves; background, no button.
    'check-writing',
    // Sorting each blocked step's ask on Dash into a job for you or a
    // question (plan #1176). Jev, one call per ask not seen before; from the
    // Dash page, no button.
    'sort-waiting',
    // Triaging a note or an idea as it is filed from the header panel (plan
    // #1179). Jev, four questions in one call per note or idea filed.
    'triage-note',
    // Scoring an idea against its workspace's vision (plan #1327). Jev, one
    // question per idea: as it is filed from the header panel, and in the
    // daily catch-up for any live idea still unscored; no button.
    'score-idea',
    // The weekly review of the week just gone (plan #1232). Sonnet, one call
    // per person a week from the Sunday week-review cron, none on a week with
    // nothing counted; background.
    'write-week-review',
    // Embedding passages of what the person wrote or did across the modules,
    // so Dash can find them by meaning (plan #1247). Voyage; background, from
    // the five-minute memory sweep, which is also the backfill. A row is
    // embedded again only when its text changes.
    'embed-memory',
    // Embedding the question when Dash searches the person's writing by
    // meaning (plan #1248). Voyage, one short call per recall lookup, from
    // Ask Dash.
    'recall-question',
    // Reading one inspiration video's transcript for takeaways about this
    // app (plan #1409). Sonnet, one call per video not read yet, from the
    // inspiration run and its Check now button.
    'read-inspiration-video',
    // Summarising one inspiration video in a few points for the tab (note
    // b0594be6). Haiku, one call per read video without a summary, from the
    // inspiration run and its Check now button.
    'summarise-inspiration-video',
    // Embedding each new inspiration takeaway, with the plan features and
    // ideas it might repeat, to find the nearest (plan #1410). Voyage, one
    // call per run that stored new takeaways.
    'embed-inspiration-takeaways',
    // Asking whether a new inspiration takeaway is the same idea as an
    // earlier one or is already covered by the plan (plan #1410). Haiku, one
    // short call per new takeaway with something near it.
    'merge-inspiration-takeaways',
    // Jev's score on one inspiration takeaway, with the ideas' question
    // (note 790c745a). One short call per takeaway not yet scored; background,
    // from the daily idea-score catch-up.
    'score-inspiration-takeaway',
  ],
  news: [
    // Reading one newsletter issue into its stories and a summary. Haiku, one
    // call per issue; background, from the digest cron.
    'digest-issue',
    // Embedding a new issue's stories to find the same event in other
    // newsletters. Voyage; background, beside the digest.
    'group-stories',
    // Rating each story out of 100 once its newsletter is summarised. Jev, one
    // call per story, with Haiku for the stories Jev could not answer;
    // background, on arrival and from the digest cron.
    'score-importance',
    // The one-off measurement script behind #872, run by hand. Voyage.
    'measure-repeats',
    // Making the list of free newsletters recommended on the Newsletters tab,
    // with a web search for each topic. Opus, one run per press of Reload.
    'recommend-newsletters',
    // Dash's reply when you discuss a Quick read story (plan #1060). Sonnet,
    // one call per round, three rounds at most.
    'discuss-story',
  ],
  goals: [
    // Filing a sentence from the capture box against open goals and steps
    // (plan #929). Haiku, one call per sentence.
    'file-capture',
    // Guessing which move a sentence in the capture box is while it is typed
    // (plan #1177). Jev, one call per pause in typing of 300 ms or more.
    'sort-capture',
    // Reading pasted text or a document into an information step's form
    // (plan #955). Haiku, one call per paste or file.
    'read-into-form',
    // Dash replying to a comment tagged @dash on a goal or a step, and filing
    // any facts it gives into a collection (plan #957). Haiku.
    'reply-to-goal-comment',
    // Reading what arrived since the last morning run against every open
    // step of the person's, so the run sees only what bears on one (plan
    // #1176). Jev, one call per item and forty steps; background, from the
    // daily cron.
    'filter-evidence',
    // Asking whether each open Claude step with no acts sentence would send,
    // submit, buy or change records outside the plan, before a goals run
    // starts or a step is sent (plan #1183). Jev, one call per step;
    // background, since no button of its own starts it.
    'check-step-acts',
    // Writing the acts sentence for a step that check held (plan #1183).
    // Haiku, one call per held step; background.
    'write-acts-sentence',
    // Reading what a finished goals run wrote on the Claude steps it closed,
    // for an action outside the plan (plan #1184). Jev, one call per step;
    // background, run by the overnight tick.
    'check-run-acts',
  ],
} as const;

export type JobsOperation = (typeof SPEND_OPERATIONS.jobs)[number];
export type ShoppingOperation = (typeof SPEND_OPERATIONS.shopping)[number];
export type CoreOperation = (typeof SPEND_OPERATIONS.core)[number];
export type NewsOperation = (typeof SPEND_OPERATIONS.news)[number];
export type GoalsOperation = (typeof SPEND_OPERATIONS.goals)[number];

/** A module and one of its operations, as a pair that cannot be mismatched. */
export type SpendOperation =
  | { module: 'jobs'; operation: JobsOperation }
  | { module: 'shopping'; operation: ShoppingOperation }
  | { module: 'core'; operation: CoreOperation }
  | { module: 'news'; operation: NewsOperation }
  | { module: 'goals'; operation: GoalsOperation };
