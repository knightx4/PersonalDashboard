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
    // Dash answering a comment on a dev page. Haiku.
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
  ],
  news: [
    // Reading one newsletter issue into its stories and a summary. Haiku, one
    // call per issue; background, from the digest cron.
    'digest-issue',
    // Embedding a new issue's stories to find the same event in other
    // newsletters. Voyage; background, beside the digest.
    'group-stories',
    // Rating the importance of stories stored before the digest rated them.
    // Haiku, one short call per newsletter; background, from the digest cron.
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
    // Reading pasted text or a document into an information step's form
    // (plan #955). Haiku, one call per paste or file.
    'read-into-form',
    // Dash replying to a comment tagged @dash on a goal or a step, and filing
    // any facts it gives into a collection (plan #957). Haiku.
    'reply-to-goal-comment',
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
