/**
 * What the row said, written out for the reply.
 *
 * The fast path has no repository and no database — it gets one message and
 * answers out of it — so everything it could reasonably need has to be in that
 * message. A plan step already has this: `planBrief` is the step written out
 * for whoever is about to build it, decided questions and all. An idea and a
 * raise had nothing of the kind, so they get one here.
 *
 * The thread so far goes in as well. A second question on a row is almost
 * always about the first answer, and without the exchange the reply starts
 * again from the top.
 */
import type { DevComment } from './load';
import type { IdeaRow } from '@/lib/ideas/load';
import type { RaisedRow } from '@/lib/raised/load';
import { MODULES } from '@/lib/modules';

function moduleLabel(module: string | null): string {
  return module ? (MODULES.find((m) => m.id === module)?.label ?? module) : 'The app as a whole';
}

/** An idea as it stands: what it says, where it belongs, and whether it is in the plan. */
export function ideaContext(idea: IdeaRow): string {
  const out = ['# An idea', '', `Module: ${moduleLabel(idea.module)}`];
  out.push(`Written by: ${idea.source === 'claude' ? 'a session, as a suggestion' : 'the person'}`);
  if (idea.from) out.push(`Came out of: #${idea.from.number} ${idea.from.title}`);
  out.push(
    idea.planItem
      ? `In the plan as #${idea.planItem.number} ${idea.planItem.title} (${idea.planItem.status})`
      : 'Not shaped into a plan feature yet.',
  );
  out.push('', idea.body);
  return out.join('\n') + '\n';
}

/** A raise as it stands: what it is about, the evidence, and the move it wants back. */
export function raiseContext(row: RaisedRow): string {
  const out = [`# A raise — ${row.title}`, '', `Module: ${moduleLabel(row.module)}`, `Status: ${row.status}`];
  if (row.source) out.push(`Raised by: ${row.source}`);
  if (row.ask) out.push('', '## What it asks for', '', row.ask);
  if (row.detail) out.push('', '## The evidence', '', row.detail);
  return out.join('\n') + '\n';
}

/**
 * The exchange so far, oldest first.
 *
 * The comment carrying the question is left out by its caller: it is asked in
 * its own section rather than as the last line of the history, so the reply
 * cannot mistake it for something already dealt with.
 */
export function threadText(thread: readonly DevComment[]): string {
  if (thread.length === 0) return '';
  const lines = thread.map(
    (comment) => `${comment.author === 'claude' ? 'Claude' : 'The person'}: ${comment.body}`,
  );
  return ['## Said so far on this row', '', ...lines].join('\n') + '\n';
}

/** The whole message the reply is produced from. */
export function askMessage(input: {
  context: string;
  thread: readonly DevComment[];
  question: string;
}): string {
  const parts = [input.context.trimEnd()];
  const said = threadText(input.thread);
  if (said) parts.push(said.trimEnd());
  parts.push(['## The question', '', input.question].join('\n'));
  return parts.join('\n\n') + '\n';
}
