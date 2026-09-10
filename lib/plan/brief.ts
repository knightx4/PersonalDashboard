import { MODULES } from '@/lib/modules';
import { isClosed, type PlanStatus } from './load';
import { reshapeOrigin } from './origin';
import { ancestorsOf, flatten, type PlanNode, type PlanSection } from './tree';

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

function line(node: Pick<PlanNode, 'number' | 'title' | 'status'>): string {
  const box = node.status === 'done' ? '[x]' : node.status === 'dropped' ? '[-]' : '[ ]';
  return `- ${box} #${node.number} ${node.title}${
    node.status === 'in_progress' || node.status === 'blocked' ? ` (${STATUS_WORD[node.status]})` : ''
  }`;
}

function steps(nodes: readonly PlanNode[], indent = ''): string[] {
  return nodes.flatMap((node) => [indent + line(node), ...steps(node.children, indent + '  ')]);
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
 * Several steps written out as one hand-over.
 *
 * The order is the running order, so the checklist at the top is both the
 * contents and the instruction: work them down the list. Then each step's own
 * brief in full, because the session on the other end cannot be assumed to be
 * able to read the plan for itself — that is why briefs are carried in the
 * message at all — and a queue of names with no detail behind them would leave
 * it guessing at every one.
 *
 * A step that waits on another is included and says so in its own brief. It is
 * part of what was handed over, and dropping it here would mean a batch that
 * quietly did less than it was asked to.
 */
export function planQueueBrief(
  sections: readonly PlanSection[],
  nodes: readonly PlanNode[],
): string {
  const out: string[] = [];

  out.push(`# ${nodes.length} plan ${nodes.length === 1 ? 'step' : 'steps'}, in order`);
  out.push('');
  for (const [index, node] of nodes.entries()) {
    const facts = [moduleLabel(node.module), PRIORITY_WORD[node.priority]];
    if (node.waitingOn.length > 0) {
      facts.push(`waits on ${node.waitingOn.map((ref) => `#${ref.number}`).join(', ')}`);
    }
    out.push(`${index + 1}. #${node.number} ${node.title} — ${facts.join(' · ')}`);
  }

  for (const node of nodes) {
    out.push('', '---', '', planBrief(sections, node).trimEnd());
  }

  return out.join('\n') + '\n';
}

export function planBrief(sections: readonly PlanSection[], node: PlanNode): string {
  const ancestors = ancestorsOf(sections, node.id);
  const out: string[] = [];

  const feature = featureOf(node, ancestors);
  const decided = decidedSoFar(feature, node);

  out.push(`# Plan step #${node.number} — ${node.title}`);
  out.push('');

  const facts = [
    `Module: ${moduleLabel(node.module)}`,
    `Status: ${STATUS_WORD[node.status]}`,
    `Priority: ${PRIORITY_WORD[node.priority]}`,
  ];
  if (node.size) facts.push(`Size: ${node.size.toUpperCase()}`);
  if (node.assignee) facts.push(`Assigned: ${node.assignee === 'claude' ? 'Claude' : 'me'}`);
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
  // reaches for is plausible steps invented to fill the gap.
  if (node.fog) {
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
    out.push('', '## Steps', '', ...steps(node.children));
  }

  if (node.blocks.length > 0) {
    out.push('', '## Unblocks', '');
    for (const ref of node.blocks) out.push(`- #${ref.number} ${ref.title}`);
  }

  if (node.comment) {
    out.push('', '## Notes', '', node.comment);
  }

  if (node.resolution) {
    out.push('', '## Answered', '', node.resolution);
  }

  if (node.commitSha) {
    out.push('', `Shipped in ${node.commitSha}.`);
  }

  return out.join('\n') + '\n';
}
