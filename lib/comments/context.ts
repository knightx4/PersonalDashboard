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
import type { FeedbackRow } from '@/lib/feedback/load';
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
 * A bug report or a feature request as it stands.
 *
 * The resolution note is the half a question is usually about: it holds what a
 * run said when it stopped, which on a blocked note is the question it is
 * waiting on. The page path says where the person was standing when they filed
 * it, which is often the whole of what the sentence leaves out.
 */
export function noteContext(note: FeedbackRow): string {
  const out = [
    note.kind === 'bug' ? '# A bug report' : '# A feature request',
    '',
    `Status: ${note.status}`,
    `Filed: ${note.createdAt.slice(0, 10)}`,
  ];
  if (note.pagePath) out.push(`Filed from: ${note.pagePath}`);
  out.push('', note.body);
  if (note.resolutionNote) {
    out.push('', '## What a run said about it', '', note.resolutionNote);
  }
  return out.join('\n') + '\n';
}

/**
 * One comment, marked as whose it is.
 *
 * Both halves of the conversation are written under the same account, so the
 * marker is the only thing that says which of them wrote a line. Shared with
 * the plan brief, which prints comments per row rather than as one history.
 */
export function commentLine(comment: DevComment): string {
  return `${comment.author === 'claude' ? 'Claude' : 'The person'}: ${comment.body}`;
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
  return ['## Said so far on this row', '', ...thread.map(commentLine)].join('\n') + '\n';
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

/**
 * A section of a specification, with the document it belongs to.
 *
 * The section's own prose is included in full rather than summarised, because
 * a question asked on a spec is almost always about the exact wording — "why
 * does this rule out X" is unanswerable from a paraphrase. The documents cap at
 * a few thousand characters per section, so this is affordable.
 *
 * The surrounding document is named but not included. A section is the unit
 * somebody argues with, and handing over 650 lines to answer a question about
 * one heading is how a cheap call becomes an expensive one.
 */
export function specContext(spec: {
  title: string;
  file: string;
  heading: string;
  body: string;
}): string {
  return (
    [
      `# ${spec.heading}`,
      '',
      `A section of ${spec.title}, which is \`docs/${spec.file}\` in the repository.`,
      '',
      'The section, in full:',
      '',
      spec.body,
    ].join('\n') + '\n'
  );
}
