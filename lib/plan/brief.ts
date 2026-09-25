import { commentLine } from '@/lib/comments/context';
import { MODULES } from '@/lib/modules';
import { hasLiveFog, isClosed, isDismissed, type PlanStatus } from './load';
import { reshapeOrigin } from './origin';
import {
  ancestorsOf,
  flatten,
  type PlanLiveness,
  type PlanNode,
  type PlanSection,
} from './tree';

/**
 * A step written out for whoever is about to build it.
 *
 * The page shows a step in its place; a brief is the step taken out of the
 * page and handed over — to a session, a routine, a pasted message — with
 * everything it needs carried along: where it sits, what it involves, what
 * done means, what it waits on and what is beneath it. Markdown, because
 * that is what the reader on the other end reads.
 *
 * Deliberately the whole story and nothing else. A brief that leaves out the
 * acceptance criteria produces work checked against nobody's definition of
 * done; one that pads itself with the rest of the plan buries the step.
 */

/**
 * The one writing rule every routine that writes a plan row carries.
 *
 * The skill says it at length; this says it in the instruction itself, so a
 * session has it before it has read anything. It is here rather than in either
 * caller because shaping and re-shaping both write rows the person reads, and
 * a rule that applied to only one of them would show up as half the plan being
 * legible.
 *
 * The complaint it answers, in full: "I basically never have any idea what you
 * are saying on any of the plan stuff." Every detail on the page opened with a
 * file path and never said what the step gives the person who owns the app.
 */
export const PLAIN_ENGLISH_RULE =
  'Write it in plain English. The person reading the plan page owns this app ' +
  'and decides what gets built; they are not going to open a file to work out ' +
  'what a step is. So the FIRST SENTENCE of every detail says what will be ' +
  'different for them and names nothing from the codebase -- no file paths, no ' +
  'table names, no type or function names -- and the rest is as technical as it ' +
  'needs to be. Same for a title, a question, its options, and any fog. Read ' +
  'your first sentence back and ask whether somebody who has never opened this ' +
  'repository would know what they are getting; if not, it is not written yet. ' +
  'No stock phrases, no metaphor for machinery, no claims about why the step ' +
  'matters.';

/**
 * What a session may write as fog, said in the instruction itself.
 *
 * Fog is the part of the feature in hand that cannot be specified until more
 * of it exists. It was being used for anything a session thought of and did
 * not want to lose: whether ten interview questions should be asked again
 * months later, whether the five-minute reading unit should exist for reading
 * too, what a selection is for on a list belonging to a different feature.
 * None of those stop their feature being finished, and fog is the one place
 * nothing reads again -- the feature ships, the patch stays, and the thought
 * is lost more thoroughly than if it had been dropped.
 *
 * So the test is about finishing rather than about certainty, and a follow-on
 * has somewhere else to go. Carried by shaping and re-shaping both, for the
 * same reason as the writing rule above: these are the two jobs that write
 * fog, and a rule only one of them had would show up as half the plan
 * collecting it again.
 */
export const FOG_RULE =
  'Fog is only what cannot be decided until part of THIS feature exists. ' +
  'Before writing any, ask: if this is never resolved, is the feature still ' +
  'finished? If yes, it is a follow-on, not fog -- file it on the ideas page ' +
  '(plan.ts idea "the follow-on" --module <id>) and name it in your report. If ' +
  'no, and it can be phrased sharply now, it is a decision step; if it cannot ' +
  'be phrased yet, it is fog. One patch per feature: fog is a single column, ' +
  'so a second one replaces the first rather than joining it, and a feature ' +
  'that seems to need two has one of them wrong.';

/**
 * Which questions are worth the person's time, said in the instruction itself.
 *
 * Sessions were writing a decision for every choice with two defensible
 * answers: a label, a default, a sort order, which of two equivalent ways to
 * store something. The person's report was that they take the recommended
 * option nearly every time, so each of those questions cost them a visit to
 * the page and bought nothing but a delay on the step waiting behind it.
 *
 * So the bar moves from "could reasonably go either way" to "the person would
 * plausibly pick differently, and it would matter if they did". Everything
 * under it is decided by the session and written down where the person will
 * see it, which keeps it vetoable without making it a question. Carried by
 * shaping, re-shaping and building, the three jobs that write decisions.
 */
export const QUESTION_RULE =
  'Ask the person only what is worth their time. They take the recommended ' +
  'option almost every time, so a question whose answer you would recommend ' +
  'and they would very likely accept is not a question: decide it yourself. ' +
  'Write a decision only when at least one of these holds: it is hard to undo ' +
  '(deleting or rewriting their data, a stored shape that will fill with data, ' +
  'anything sent outside the app, money); it changes what they see or do in a ' +
  'way they could reasonably want the other way and nothing already settles ' +
  '(the design laws, the code, an earlier answer, the idea itself); or it ' +
  'changes the scope, meaning whether to build something at all or build ' +
  'noticeably more or less than was asked. Names, wording, layout within the ' +
  'design laws, defaults, thresholds, ordering, which of two equivalent ' +
  'implementations: decide those and keep going. Say what you chose and why in ' +
  'one line where the person reads it (the detail of a proposed row, or the ' +
  'note you close a step with), so they can still overrule it. Most features ' +
  'need no questions; two is a lot.';

/**
 * What "not right now" means to a session, said in the instruction itself.
 *
 * Dismissing is the way out of a question you do not want to settle and a fog
 * patch you do not want raised again. It only works if the next run reads it:
 * a re-shape that cannot see what was put aside re-derives the same question
 * from the same code and writes it back, which is the loop this is meant to
 * end. So the dismissed rows are listed in the turn, and this says what to do
 * about them.
 */
export const DISMISSAL_RULE =
  'Anything listed as dismissed has been put aside by the person as not right ' +
  'now. Respect it: do not propose it again, do not ask the same question in ' +
  'different words, do not write it back as fog, and do not file it as an idea. ' +
  'Dismissing and bringing one back are both the person\'s moves, on /dev/plan ' +
  'and /dev/ideas -- a session never does either.';

export const STATUS_WORD: Record<PlanStatus, string> = {
  proposed: 'proposed',
  not_started: 'not started',
  in_progress: 'in progress',
  blocked: 'blocked',
  done: 'done',
  dropped: 'dropped',
};

const PRIORITY_WORD = { 1: 'next', 2: 'normal', 3: 'someday' } as const;

function moduleLabel(module: PlanNode['module']): string {
  return module ? (MODULES.find((m) => m.id === module)?.label ?? module) : 'The app as a whole';
}

/**
 * What a claim on a step is worth saying about it.
 *
 * The three readings of `in_progress`, in the words a session needs rather
 * than the page's: it is about to decide whether to leave that step alone.
 * Empty for a claim nothing has looked into, which is what the status word on
 * its own already says.
 */
const CLAIM_PHRASE: Record<string, string> = {
  working: 'in progress, its run still pushing',
  quiet: 'in progress, its run quiet',
  abandoned: 'claimed by a run that ended without closing it',
};

/** How a step's state reads, with the run behind a claim taken into account. */
function stateWord(
  node: Pick<PlanNode, 'id' | 'status'>,
  liveness: PlanLiveness | undefined,
): string {
  const claim = liveness?.[node.id];
  return (claim && CLAIM_PHRASE[claim]) || STATUS_WORD[node.status];
}

function line(
  node: Pick<PlanNode, 'id' | 'number' | 'title' | 'status'>,
  liveness?: PlanLiveness,
): string {
  const box = node.status === 'done' ? '[x]' : node.status === 'dropped' ? '[-]' : '[ ]';
  return `- ${box} #${node.number} ${node.title}${
    node.status === 'in_progress' || node.status === 'blocked'
      ? ` (${stateWord(node, liveness)})`
      : ''
  }`;
}

/**
 * The steps under a step, as a checklist. A dismissed one is left out, with
 * everything beneath it: the brief is what a session works from, and a
 * question put aside is not part of the job.
 */
function steps(
  nodes: readonly PlanNode[],
  indent = '',
  liveness?: PlanLiveness,
): string[] {
  return nodes
    .filter((node) => !isDismissed(node))
    .flatMap((node) => [
      indent + line(node, liveness),
      ...steps(node.children, indent + '  ', liveness),
    ]);
}

/**
 * The feature a step belongs to: the nearest step above it that says what
 * being finished means. That is what a feature is in practice — the level at
 * which somebody wrote down a destination — so it is found rather than
 * declared, and a plan two levels deep and one five levels deep both work.
 *
 * A step with no such ancestor is its own feature, which is what a top-level
 * step is. Its destination is its own done-when, already printed, so nothing
 * is repeated; what it gains is the decisions settled beneath it.
 */
function featureOf(node: PlanNode, ancestors: readonly PlanNode[]): PlanNode {
  for (let i = ancestors.length - 1; i >= 0; i -= 1) {
    if (ancestors[i].acceptance) return ancestors[i];
  }
  return ancestors[0] ?? node;
}

/**
 * Every question already settled beneath a feature, with its answer.
 *
 * This is the whole point of the feature: a session three nights later builds
 * against what was decided without being told again, and never asks the same
 * question twice. Generated from the rows rather than maintained by hand, so
 * it cannot fall out of date. Dropped decisions are left out — a question
 * withdrawn was never answered — and so is the step being briefed, which does
 * not need to be told its own answer.
 */
function decidedSoFar(feature: PlanNode, node: PlanNode): PlanNode[] {
  return flatten([feature]).filter(
    (item) =>
      item.id !== node.id &&
      item.kind === 'decision' &&
      item.status === 'done' &&
      Boolean(item.resolution),
  );
}

/**
 * What a brief carries beyond the step itself.
 *
 * The thread is off by default because most callers already have it or do not
 * want it: the `@dash` path prints the exchange in its own section with the
 * question taken out of it, and the CLI reads plan rows over a direct
 * connection that asks for no comments at all. The three hand-over buttons on
 * the plan page turn it on, because there the comments are the only place some
 * of what the person decided was ever written down.
 */
export type BriefOptions = {
  /** Print the comments on the step and on the steps beneath it. */
  thread?: boolean;
  /**
   * What the runs say about the claimed steps, from `planLiveness`.
   *
   * A brief is read by a session about to work the step, and "in progress" is
   * the one fact on it that can be false: the row says a session has this and
   * says nothing about whether that session is still going. With this the
   * brief says which, off the same reading the page and the send guard use.
   * Without it, a claim reads as the status column reads.
   */
  liveness?: PlanLiveness;
};

/**
 * What has been said on the rows a brief carries, oldest first.
 *
 * Grouped by row rather than run together, because a hand-over carries a whole
 * subtree and a comment left on one step means something different from the
 * same words left on the feature above it. Each line says who wrote it: both
 * halves of the conversation are written under the person's account, so
 * without the marker a session cannot tell its own past replies from theirs.
 *
 * Dismissed rows are left out, the same as in the checklist.
 */
function saidOn(node: PlanNode): string[] {
  const rows = flatten([node]).filter((item) => !isDismissed(item) && item.thread.length > 0);
  if (rows.length === 0) return [];

  const out = ['', '## Comments', '', 'Left on these rows, oldest first.'];
  for (const row of rows) {
    out.push('', `On #${row.number} ${row.title}:`, '');
    for (const comment of row.thread) out.push(`- ${commentLine(comment)}`);
  }
  return out;
}

/**
 * What has been put aside under a feature, for the turn that re-reads it.
 *
 * The one place dismissed rows are written out. Everywhere else they are
 * hidden, which is what dismissing them was for; here they are named so the
 * session knows what not to bring back, and each one says which kind it is,
 * because "do not ask this again" and "do not file this again" land in
 * different places.
 *
 * Empty when nothing under the feature has been dismissed, so the turn carries
 * the section only when there is something in it.
 */
export function dismissedUnder(
  feature: PlanNode,
  suggestions: readonly { body: string }[] = [],
): string {
  const rows = flatten([feature]);
  const lines: string[] = [];

  for (const item of rows) {
    if (isDismissed(item)) {
      lines.push(`- #${item.number} ${item.title} (${item.kind === 'decision' ? 'question' : 'step'})`);
    }
    if (item.fog && item.fogDismissedAt !== null) {
      lines.push(`- The fog on #${item.number}: ${firstLine(item.fog)} (fog)`);
    }
  }
  for (const idea of suggestions) {
    lines.push(`- ${firstLine(idea.body)} (suggestion, on the ideas page)`);
  }

  if (lines.length === 0) return '';
  return (
    [
      '## Already dismissed',
      '',
      'Put aside by the person as not right now. Left here so they are not written back.',
      '',
      ...lines,
    ].join('\n') + '\n'
  );
}

function firstLine(text: string): string {
  const line = text.split('\n').find((part) => part.trim()) ?? '';
  return line.trim().length > 160 ? `${line.trim().slice(0, 157)}…` : line.trim();
}

export function planBrief(
  sections: readonly PlanSection[],
  node: PlanNode,
  options: BriefOptions = {},
): string {
  const ancestors = ancestorsOf(sections, node.id);
  const out: string[] = [];

  const feature = featureOf(node, ancestors);
  const decided = decidedSoFar(feature, node);

  out.push(`# Plan step #${node.number} — ${node.title}`);
  out.push('');

  const facts = [
    `Module: ${moduleLabel(node.module)}`,
    `Status: ${stateWord(node, options.liveness)}`,
    `Priority: ${PRIORITY_WORD[node.priority]}`,
  ];
  if (node.size) facts.push(`Size: ${node.size.toUpperCase()}`);
  // Only the mark you put on a step yourself. Nothing gives a step to Dash any
  // more, so a `claude` left in the column by an old hand-over says nothing
  // about who the step is for, and the brief prints nothing for it.
  if (node.assignee === 'me') facts.push('Assigned: me');
  out.push(facts.join(' · '));

  if (ancestors.length > 0) {
    out.push(`Part of: ${ancestors.map((a) => `#${a.number} ${a.title}`).join(' › ')}`);
  }

  // Said at the top rather than left in the notes at the bottom: a step
  // written by a re-shape is one nobody remembers agreeing to, and the answer
  // that produced it is the first thing worth knowing about it.
  const origin = reshapeOrigin(node.comment);
  if (origin) {
    out.push(`From #${origin.number}'s answer: ${origin.gist}`);
  }

  // Where the whole feature is going, above what this one step is for. A step
  // built against its own done-when alone can meet it and still miss the point.
  if (feature.id !== node.id && feature.acceptance) {
    out.push('', '## Destination', '', `#${feature.number} ${feature.title} — ${feature.acceptance}`);
  }

  if (decided.length > 0) {
    out.push('', '## Decided so far', '');
    for (const item of decided) out.push(`- #${item.number} ${item.title} — ${item.resolution}`);
  }

  if (node.detail) {
    // A decision is a question with its options, not a description of work.
    out.push('', node.kind === 'decision' ? '## Question' : '## What it involves', '', node.detail);
  }

  if (node.acceptance) {
    out.push('', '## Done when', '', node.acceptance);
  }

  // What nobody can see yet. Said plainly, because the alternative a proposal
  // reaches for is plausible steps invented to fill the gap. A patch that has
  // been put aside is not said at all -- that is the whole of what dismissing
  // it does.
  if (node.fog && hasLiveFog(node)) {
    out.push('', '## Not yet specified', '', node.fog);
  }

  if (node.dependsOn.length > 0) {
    out.push('', '## Waits on', '');
    for (const link of node.dependsOn) {
      const state = isClosed(link.item.status) ? STATUS_WORD[link.item.status] : 'still open';
      out.push(`- #${link.item.number} ${link.item.title} (${state})`);
    }
  }

  const inherited = node.waitingOn.filter(
    (ref) => !node.dependsOn.some((link) => link.item.id === ref.id),
  );
  if (inherited.length > 0) {
    out.push('', 'Also held up, through a step above it, by:', '');
    for (const ref of inherited) out.push(`- #${ref.number} ${ref.title}`);
  }

  if (node.children.length > 0) {
    out.push('', '## Steps', '', ...steps(node.children, '', options.liveness));
  }

  if (node.blocks.length > 0) {
    out.push('', '## Unblocks', '');
    for (const ref of node.blocks) out.push(`- #${ref.number} ${ref.title}`);
  }

  // What it needs, above the record of every time it has been asked for. A
  // session handed a blocked step should read the sentence rather than work
  // out which paragraph of the notes still stands.
  if (node.blockAsk) {
    out.push('', '## Blocked on', '', node.blockAsk);
  }

  if (node.comment) {
    out.push('', '## Notes', '', node.comment);
  }

  if (options.thread) out.push(...saidOn(node));

  if (node.resolution) {
    out.push('', '## Answered', '', node.resolution);
  }

  if (node.commitSha) {
    out.push('', `Shipped in ${node.commitSha}.`);
  }

  return out.join('\n') + '\n';
}
