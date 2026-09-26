/**
 * Where a step came from, when it did not come from you.
 *
 * A re-shape writes rows into a feature you approved last week, and a proposed
 * step appearing under it out of nowhere is confusing in the one way this plan
 * must not be: you cannot tell whether you forgot writing it, or whether
 * something wrote it for you. So every row a re-shape adds is stamped with the
 * answer that produced it, on the first line of its comment, and the page and
 * the brief read that line back out.
 *
 * One line of text rather than a column, because it is a sentence for a person
 * and nothing queries it. A step added by hand or by a shaping session carries
 * no stamp, and reads exactly as it did before.
 */

/** The stamp itself. Written by a re-shape, read by the page and the brief. */
export type ReshapeOrigin = {
  /** The decision whose answer produced this step. */
  number: number;
  /** That answer, short enough for one line. */
  gist: string;
};

/** Long enough to say which answer it was; short enough to sit on a row. */
const MAX_GIST = 160;

/**
 * Compose the line.
 *
 * The gist comes from the decision's own `resolution` rather than from
 * whoever is writing the row, so a session cannot paraphrase an answer into
 * something the person did not say.
 */
export function reshapeStamp(number: number, resolution: string): string {
  const first = resolution.split('\n').find((line) => line.trim()) ?? '';
  const gist = first.trim();
  return `From #${number}'s answer: ${
    gist.length > MAX_GIST ? `${gist.slice(0, MAX_GIST - 1).trimEnd()}…` : gist
  }`;
}

const PATTERN = /^From #(\d+)'s answer: (.+)$/m;

/**
 * Read it back, or null when there is none.
 *
 * Matched anywhere in the comment rather than only at the start: a step
 * stamped by a re-shape can be blocked and closed like any other, and every
 * one of those appends a dated line beneath.
 */
export function reshapeOrigin(comment: string | null): ReshapeOrigin | null {
  if (!comment) return null;
  const match = PATTERN.exec(comment);
  if (!match) return null;
  return { number: Number(match[1]), gist: match[2].trim() };
}

/**
 * The second stamp: a step a session wrote ready to build.
 *
 * Approval stops at the feature (#1095). Once you approve one, a session that
 * adds a step beneath it writes the step not started rather than proposed, so
 * it can be built without a second press. The price of that is a row you did
 * not write turning up in work you already agreed to, so it says where it came
 * from: which session, and on what day. The page reads it back to mark the
 * row and offer the drop.
 *
 * Only a step written ready carries it. A proposal already waits for you, and
 * a step a person adds at a terminal is theirs and reads as it always did.
 */
export type SessionOrigin = {
  /** The Claude Code session that wrote the row, or null when it had no id. */
  session: string | null;
  /** The day it was written, YYYY-MM-DD. */
  date: string;
};

/**
 * Which session is running this, or undefined when none is.
 *
 * A remote session carries CLAUDE_CODE_REMOTE_SESSION_ID (`cse_…`, the id
 * the runs table stores as external_id); a local one only
 * CLAUDE_CODE_SESSION_ID; any Claude Code process sets CLAUDECODE. A person
 * at their own terminal has none of the three, and gets no stamp.
 */
export function currentSession(env: Record<string, string | undefined>): string | null | undefined {
  const id = env.CLAUDE_CODE_REMOTE_SESSION_ID || env.CLAUDE_CODE_SESSION_ID;
  if (id) return id;
  return env.CLAUDECODE ? null : undefined;
}

/** Compose the line: `Added by session cse_… on 2026-09-26.` */
export function sessionStamp(origin: SessionOrigin): string {
  return origin.session
    ? `Added by session ${origin.session} on ${origin.date}.`
    : `Added by a session on ${origin.date}.`;
}

const SESSION_PATTERN = /^Added by (?:session (\S+)|a session) on (\d{4}-\d{2}-\d{2})\.$/m;

/** Read it back, or null when the step was not written ready by a session. */
export function sessionOrigin(comment: string | null): SessionOrigin | null {
  if (!comment) return null;
  const match = SESSION_PATTERN.exec(comment);
  if (!match) return null;
  return { session: match[1] ?? null, date: match[2] };
}

/**
 * Whether a step added beneath this chain is a proposal.
 *
 * `ancestors` is the status of every row above the new one, nearest first. A
 * proposed row anywhere in it means the feature has not been approved, and a
 * decided step inside an undecided feature is a contradiction. With no parent
 * at all there is no feature to have approved, and the flag alone decides, as
 * it always has.
 */
export function addsAsProposal(ancestors: readonly string[], proposedFlag: boolean): boolean {
  return proposedFlag || ancestors.includes('proposed');
}
