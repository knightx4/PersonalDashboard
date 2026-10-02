import { PROJECTS } from '@/lib/plan/projects';
import { ruleScores } from '@/lib/writing/check';
import {
  LINK_PATTERN,
  MAX_THREAD_POSTS,
  X_POST_LIMIT,
  X_POST_MARGIN,
  xLength,
} from './posts';

/**
 * The check every X draft passes before the posts run inserts it (plan #1417).
 *
 * docs/X-POSTS.md lists what never goes in a post and how a post is counted.
 * This is the part of that list a rule can catch: the length, links, hashtags
 * and emoji, contact details, amounts, identifiers from the running system,
 * words that belong to another workspace, and any term the caller passes in
 * (the person's name, the companies in their job search). A draft with a
 * problem is dropped by the run, not edited around, so the check answers
 * pass or fail rather than offering a fix.
 *
 * It is a floor, not the whole check. A rule cannot tell a sentence about the
 * person's life from one about the app, which is why the run still reads each
 * draft against the guide itself.
 *
 * No `server-only` guard, so `scripts/posts-check.ts` runs it under plain tsx.
 */

export type DraftToCheck = {
  angle: string;
  /** The post and up to four more in its thread. */
  posts: readonly string[];
};

/** A plan step or note a draft cites, as the run read it. */
export type SourceToCheck = {
  /** `#1234` for a step, or a note's id, for naming it in a problem. */
  label: string;
  /** The step's workspace; null for the app as a whole. Notes pass null. */
  module: string | null;
  /** The title, detail and close note, as one string. */
  text: string;
};

export type DraftCheck = {
  ok: boolean;
  /** Each reason the draft fails. Empty when it passes. */
  problems: string[];
  /** Things worth a second look that do not fail it, such as a thin margin. */
  warnings: string[];
  /** X's count for each post, in order. */
  lengths: number[];
};

/**
 * Words that place a sentence in another workspace's data. A post about the
 * app has no reason to use them, and a step whose text does is one the run
 * leaves out (docs/X-POSTS.md, "Never in a post").
 */
export const OTHER_WORKSPACE_WORDS: readonly string[] = [
  'loan',
  'loans',
  'debt',
  'mortgage',
  'salary',
  'payslip',
  'bank statement',
  'credit card',
  'recruiter',
  'interview',
  'cover letter',
  'resume',
  'résumé',
  'employer',
  'job application',
  'job search',
  'gmail',
  'inbox',
  'journal entry',
  'diary',
  'therapy',
  'medical',
  'doctor',
  'rent',
  'tax return',
  'invoice',
  'groceries',
  'shopping list',
];

/** Phrases the guide calls launch language. */
const LAUNCH_PHRASES: readonly string[] = [
  'excited to share',
  'introducing',
  'game changer',
  'game-changer',
  'the future of',
  'the future is here',
  'big news',
  'thrilled to',
  'stay tuned',
];

/** Identifiers from the running system, and the reason each is named. */
const IDENTIFIERS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bcse_[A-Za-z0-9]+/, 'a session id'],
  [/\bsession_[A-Za-z0-9]{8,}/, 'a session id'],
  [/\btrig_[A-Za-z0-9]+/, 'a routine id'],
  [/\bsk-[A-Za-z0-9_-]{8,}/, 'a key'],
  [/\beyJ[A-Za-z0-9_-]{10,}/, 'a token'],
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i, 'a row id'],
  [/\blocalhost\b|\b127\.0\.0\.1\b/i, 'an internal address'],
];

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const MENTION = /(^|[^\w])@[A-Za-z0-9_]{2,}/;
const HASHTAG = /(^|\s)#[A-Za-z_][\w]*/;
const PHONE = /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{2,5}\)[\s.-]?)?\d{3,5}[\s.-]\d{3,4}(?:[\s.-]\d{2,4})?/;
const MONEY =
  /[$£€¥₹]\s?\d|\d\s?(?:usd|gbp|eur|dollars?|pounds?|euros?|cents?|pence|p\b)|\b\d+(?:\.\d+)?\s?k\b(?=.*(?:salary|paid|cost|spent|budget))/i;
const THREAD_MARKER = /🧵|^\s*\d+\s?\/\s?\d*(\s|$)/;
const EMOJI = /\p{Extended_Pictographic}/u;
const EM_DASH = /—/;

/** The Supabase project ref, kept out of posts by name. */
const PROJECT_REF = 'asjztutnqxbecruvyrbj';

/**
 * Terms every check refuses: the hosts of the projects the plan builds, which
 * carry the person's name, and the GitHub owners behind them.
 */
export function builtInAvoidTerms(): string[] {
  const terms = new Set<string>([PROJECT_REF]);
  for (const project of PROJECTS) {
    try {
      const host = new URL(project.url).hostname.replace(/^www\./, '');
      terms.add(host);
      terms.add(host.split('.')[0]);
    } catch {
      // A project without a parseable url has no host to keep out.
    }
    terms.add(project.repo.owner);
    terms.add(project.repo.repo);
  }
  return [...terms].filter((term) => term.length >= 3);
}

function escape(term: string): string {
  return term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Whether `text` holds `term` as a whole word or phrase.
 *
 * Case is ignored, except for a single capitalised word. Many companies in a
 * job search are named with ordinary words (Check, Scale, Context), and
 * matching those in lower case would refuse every post that says "check".
 * Written as a name, with its capital, it is still refused.
 */
export function mentions(text: string, term: string): boolean {
  const t = term.trim();
  if (!t) return false;
  const properWord = /^\p{Lu}[\p{L}\p{N}]*$/u.test(t);
  return new RegExp(
    `(^|[^\\p{L}\\p{N}])${escape(t)}($|[^\\p{L}\\p{N}])`,
    properWord ? 'u' : 'iu',
  ).test(text);
}

/** The private and off-limits content one piece of text carries, as reasons. */
export function privacyProblems(text: string, avoid: readonly string[] = []): string[] {
  const problems: string[] = [];
  LINK_PATTERN.lastIndex = 0;
  if (LINK_PATTERN.test(text)) problems.push('has a link or a domain');
  LINK_PATTERN.lastIndex = 0;
  if (EMAIL.test(text)) problems.push('has an email address');
  else if (MENTION.test(text)) problems.push('mentions an account with @');
  if (PHONE.test(text)) problems.push('has what looks like a phone number');
  if (MONEY.test(text)) problems.push('has an amount of money');
  for (const [pattern, what] of IDENTIFIERS) {
    if (pattern.test(text)) problems.push(`has ${what}`);
  }
  for (const word of OTHER_WORKSPACE_WORDS) {
    if (mentions(text, word)) problems.push(`mentions "${word}", which belongs to another workspace`);
  }
  for (const term of [...builtInAvoidTerms(), ...avoid]) {
    if (mentions(text, term)) problems.push(`names "${term}", which is on the never-in-a-post list`);
  }
  return [...new Set(problems)];
}

/** Style rules from docs/X-POSTS.md that a rule can catch. */
function styleProblems(text: string): string[] {
  const problems: string[] = [];
  if (HASHTAG.test(text)) problems.push('has a hashtag');
  if (EMOJI.test(text)) problems.push('has an emoji');
  if (THREAD_MARKER.test(text)) problems.push('has a thread marker');
  if (EM_DASH.test(text)) problems.push('has an em dash');
  const lower = text.toLowerCase();
  for (const phrase of LAUNCH_PHRASES) {
    if (lower.includes(phrase)) problems.push(`uses launch language ("${phrase}")`);
  }
  for (const score of ruleScores({ body: text })) {
    if (score.score === 0) continue;
    if (score.pattern === 'inflated_contrast') problems.push('uses an inflated contrast ("not X, it\'s Y")');
    if (score.pattern === 'stock_formula') problems.push('uses a stock formula ("not only X but also Y")');
  }
  return problems;
}

/** Check one draft: its shape, each post's length, privacy and style. */
export function checkDraft(draft: DraftToCheck, avoid: readonly string[] = []): DraftCheck {
  const problems: string[] = [];
  const warnings: string[] = [];

  const angle = draft.angle.trim();
  if (!angle) problems.push('has no angle');
  if (angle.length > 300) problems.push('has an angle over 300 characters');
  for (const p of privacyProblems(angle, avoid)) problems.push(`angle ${p}`);

  const posts = draft.posts.map((post) => post.trim());
  if (posts.length === 0) problems.push('has no posts');
  if (posts.length > MAX_THREAD_POSTS) {
    problems.push(`has ${posts.length} posts; a thread holds at most ${MAX_THREAD_POSTS}`);
  }

  const lengths = posts.map(xLength);
  posts.forEach((post, i) => {
    const where = posts.length > 1 ? `post ${i + 1}` : 'the post';
    if (!post) problems.push(`${where} is empty`);
    if (lengths[i] > X_POST_LIMIT) {
      problems.push(`${where} is ${lengths[i]} characters; the limit is ${X_POST_LIMIT}`);
    } else if (lengths[i] > X_POST_LIMIT - X_POST_MARGIN) {
      warnings.push(`${where} is ${lengths[i]} characters, leaving under ${X_POST_MARGIN} to edit`);
    }
    for (const p of [...privacyProblems(post, avoid), ...styleProblems(post)]) {
      problems.push(`${where} ${p}`);
    }
  });

  return { ok: problems.length === 0, problems, warnings, lengths };
}

/**
 * Whether a cited step or note may be a source at all: the step is in Dev or
 * the app as a whole, and its text says nothing about another workspace's data
 * or names anyone on the avoid list. The reasons are empty when it may.
 *
 * Links, paths, session stamps and row ids are ordinary in a step's text and
 * are not held against it; only the post must not carry them.
 */
export function sourceProblems(source: SourceToCheck, avoid: readonly string[] = []): string[] {
  const problems: string[] = [];
  if (source.module !== null && source.module !== 'dev') {
    problems.push(`${source.label} is in the ${source.module} workspace`);
  }
  if (EMAIL.test(source.text)) problems.push(`${source.label} has an email address`);
  for (const word of OTHER_WORKSPACE_WORDS) {
    if (mentions(source.text, word)) {
      problems.push(`${source.label} mentions "${word}", which belongs to another workspace`);
    }
  }
  for (const term of [...builtInAvoidTerms(), ...avoid]) {
    if (mentions(source.text, term)) {
      problems.push(`${source.label} names "${term}", which is on the never-in-a-post list`);
    }
  }
  return problems;
}
