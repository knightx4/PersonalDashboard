/**
 * What a person on People texts you about, as a rule the daily round can
 * check (plan #2931). You write a brief in your own words on their edit form;
 * Dash makes it into this rule (#2931.2), saved in
 * you.board_advisors.reach_out_rule, and the round follows it (#2931.5).
 *
 * The database refuses a rule of any other shape (you.reach_out_rule_valid,
 * you 0044). `parseReachOutRule` holds the same rules, so a rule a model
 * wrote is checked before it is saved and a bad one is reported rather than
 * thrown by the database. Change both together.
 */

export const REACH_OUT_MODES = ['each', 'roundup', 'pick'] as const;
/** each: a text per new row. roundup: one text about the rows since the last. pick: one row, now and then. */
export type ReachOutMode = (typeof REACH_OUT_MODES)[number];

export const REACH_OUT_FORMS = ['list', 'bubbles'] as const;
export type ReachOutForm = (typeof REACH_OUT_FORMS)[number];

export const REACH_OUT_LIMITS = {
  watches: 8,
  tables: 6,
  keyLength: 40,
  about: 200,
  everyDays: 90,
  repeatAfterDays: 3650,
  cannotWatch: 8,
  cannotWatchLength: 200,
  brief: 2000,
  summary: 600,
  words: 8,
  wordLength: 60,
  amount: 10_000_000,
  days: 90,
  from: 200,
} as const;

/**
 * What a fixed watch kind is told (plan #3030.3): the topics or subject words
 * to match, an amount in the account's currency (major units, so 2000 is
 * £2,000), a number of days ahead, and a sender's name or address. Which of
 * them a kind reads is lib/you/reach-out-kinds.ts's business.
 */
export type ReachOutParams = {
  words?: string[];
  amount?: number;
  days?: number;
  from?: string;
};

const PARAM_KEYS = ['words', 'amount', 'days', 'from'] as const;

export type ReachOutWatch = {
  /** Unique in the rule; advisor_reach_outs.watch_key names it. */
  key: string;
  /** What it watches, in plain words. */
  about: string;
  /** schema.table names from the sources catalogue. */
  tables: string[];
  mode: ReachOutMode;
  /** How often, in days. */
  every_days: number;
  /** Days before the same row may be named again; null for never. */
  repeat_after_days: number | null;
  form?: ReachOutForm;
  /**
   * A fixed watch kind (lib/you/reach-out-kinds.ts, plan #3030.3): the round
   * reads its rows with the kind's own reader rather than from `tables`,
   * which then names the one table the rows are recorded under.
   */
  kind?: string;
  params?: ReachOutParams;
  /** Text at its cadence even when nothing is new: "a daily summary either way". */
  always?: boolean;
};

export type ReachOutRule = {
  version: 1;
  watches: ReachOutWatch[];
  /** What the brief asked for that no table holds. */
  cannot_watch?: string[];
};

const KEY = /^[a-z][a-z0-9_]{0,39}$/;
const TABLE = /^[a-z_][a-z0-9_]{0,62}\.[a-z_][a-z0-9_]{0,62}$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function wholeIn(value: unknown, min: number, max: number): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

function textIn(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.trim().length >= 1 && value.trim().length <= max;
}

/** Why a watch's params would be refused, or null when they would not. */
export function paramsError(params: unknown): string | null {
  if (!isObject(params)) return 'params is not an object.';
  const unknown = Object.keys(params).filter((k) => !(PARAM_KEYS as readonly string[]).includes(k));
  if (unknown.length) return `unknown param ${unknown[0]}.`;
  if ('words' in params) {
    const words = params.words;
    if (!Array.isArray(words) || words.length < 1 || words.length > REACH_OUT_LIMITS.words) {
      return `words is a list of one to ${REACH_OUT_LIMITS.words}.`;
    }
    if (!words.every((w) => textIn(w, REACH_OUT_LIMITS.wordLength))) return 'a word is empty or too long.';
  }
  if ('amount' in params) {
    const amount = params.amount;
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0 || amount > REACH_OUT_LIMITS.amount) {
      return `amount is not a number above 0 and up to ${REACH_OUT_LIMITS.amount}.`;
    }
  }
  if ('days' in params && !wholeIn(params.days, 1, REACH_OUT_LIMITS.days)) return `days is not a whole number from 1 to ${REACH_OUT_LIMITS.days}.`;
  if ('from' in params && !textIn(params.from, REACH_OUT_LIMITS.from)) return 'from is empty or too long.';
  return null;
}

/** The rule, or why it would be refused. */
export function parseReachOutRule(value: unknown): { rule: ReachOutRule } | { error: string } {
  if (!isObject(value)) return { error: 'The rule is not an object.' };
  const extra = Object.keys(value).filter((k) => !['version', 'watches', 'cannot_watch'].includes(k));
  if (extra.length) return { error: `Unknown key ${extra[0]}.` };
  if (value.version !== 1) return { error: 'The version is not 1.' };
  const watches = value.watches;
  if (!Array.isArray(watches) || watches.length < 1 || watches.length > REACH_OUT_LIMITS.watches) {
    return { error: `A rule has one to ${REACH_OUT_LIMITS.watches} watches.` };
  }
  const keys = new Set<string>();
  for (const watch of watches) {
    if (!isObject(watch)) return { error: 'A watch is not an object.' };
    const unknown = Object.keys(watch).filter(
      (k) => !['key', 'about', 'tables', 'mode', 'every_days', 'repeat_after_days', 'form', 'kind', 'params', 'always'].includes(k),
    );
    if (unknown.length) return { error: `Unknown key ${unknown[0]} on a watch.` };
    if (typeof watch.key !== 'string' || !KEY.test(watch.key)) return { error: 'A watch key is not a short snake_case name.' };
    if (keys.has(watch.key)) return { error: `Two watches are called ${watch.key}.` };
    keys.add(watch.key);
    if (!textIn(watch.about, REACH_OUT_LIMITS.about)) return { error: `${watch.key}: what it is about is empty or too long.` };
    const tables = watch.tables;
    if (!Array.isArray(tables) || tables.length < 1 || tables.length > REACH_OUT_LIMITS.tables) {
      return { error: `${watch.key}: a watch reads one to ${REACH_OUT_LIMITS.tables} tables.` };
    }
    if (!tables.every((t) => typeof t === 'string' && TABLE.test(t))) return { error: `${watch.key}: a table is not schema.table.` };
    if (new Set(tables).size !== tables.length) return { error: `${watch.key}: a table is named twice.` };
    if (!(REACH_OUT_MODES as readonly unknown[]).includes(watch.mode)) return { error: `${watch.key}: the mode is not each, roundup or pick.` };
    if (!wholeIn(watch.every_days, 1, REACH_OUT_LIMITS.everyDays)) {
      return { error: `${watch.key}: every_days is not a whole number from 1 to ${REACH_OUT_LIMITS.everyDays}.` };
    }
    if (!('repeat_after_days' in watch)) return { error: `${watch.key}: repeat_after_days is missing (null for never).` };
    if (watch.repeat_after_days !== null && !wholeIn(watch.repeat_after_days, 1, REACH_OUT_LIMITS.repeatAfterDays)) {
      return { error: `${watch.key}: repeat_after_days is not null or a whole number from 1 to ${REACH_OUT_LIMITS.repeatAfterDays}.` };
    }
    if ('form' in watch && !(REACH_OUT_FORMS as readonly unknown[]).includes(watch.form)) {
      return { error: `${watch.key}: the form is not list or bubbles.` };
    }
    if ('kind' in watch && (typeof watch.kind !== 'string' || !KEY.test(watch.kind))) {
      return { error: `${watch.key}: the kind is not a short snake_case name.` };
    }
    if ('always' in watch && typeof watch.always !== 'boolean') return { error: `${watch.key}: always is not true or false.` };
    if ('params' in watch) {
      const why = paramsError(watch.params);
      if (why) return { error: `${watch.key}: ${why}` };
    }
  }
  if ('cannot_watch' in value) {
    const cannot = value.cannot_watch;
    if (!Array.isArray(cannot) || cannot.length > REACH_OUT_LIMITS.cannotWatch) {
      return { error: `cannot_watch is a list of at most ${REACH_OUT_LIMITS.cannotWatch}.` };
    }
    if (!cannot.every((c) => textIn(c, REACH_OUT_LIMITS.cannotWatchLength))) return { error: 'An entry in cannot_watch is empty or too long.' };
  }
  return { rule: value as ReachOutRule };
}
