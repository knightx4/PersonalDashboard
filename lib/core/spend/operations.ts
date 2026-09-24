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
    // Proposing evidence items from a pasted or uploaded source, on the
    // evidence settings page. Opus.
    'propose-evidence',
  ],
  shopping: [
    // Reading an order confirmation email into an order: from inbox ingest,
    // from reparsing confirmations, and from the review page's read button.
    // Haiku, one call per email.
    'extract-email-order',
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
  ],
  news: [
    // Reading one newsletter issue into its stories and a summary. Haiku, one
    // call per issue; background, from the digest cron.
    'digest-issue',
    // Embedding a new issue's stories to find the same event in other
    // newsletters. Voyage; background, beside the digest.
    'group-stories',
    // The one-off measurement script behind #872, run by hand. Voyage.
    'measure-repeats',
    // Making the list of free newsletters recommended on the Newsletters tab,
    // with a web search for each topic. Opus, one run per press of Reload.
    'recommend-newsletters',
  ],
} as const;

export type JobsOperation = (typeof SPEND_OPERATIONS.jobs)[number];
export type ShoppingOperation = (typeof SPEND_OPERATIONS.shopping)[number];
export type CoreOperation = (typeof SPEND_OPERATIONS.core)[number];
export type NewsOperation = (typeof SPEND_OPERATIONS.news)[number];

/** A module and one of its operations, as a pair that cannot be mismatched. */
export type SpendOperation =
  | { module: 'jobs'; operation: JobsOperation }
  | { module: 'shopping'; operation: ShoppingOperation }
  | { module: 'core'; operation: CoreOperation }
  | { module: 'news'; operation: NewsOperation };
