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
 * An inspiration takeaway (notes c934aefe and eef7e9f1): the idea Dash took
 * from a video for this app, with the videos it came from.
 */
export function takeawayContext(takeaway: {
  title: string;
  body: string;
  module: string | null;
  status: string;
  videos: readonly string[];
}): string {
  const out = [
    `# An inspiration takeaway — ${takeaway.title}`,
    '',
    `Module: ${moduleLabel(takeaway.module)}`,
    `Status: ${takeaway.status}`,
  ];
  if (takeaway.videos.length > 0) out.push(`From: ${takeaway.videos.join('; ')}`);
  out.push('', takeaway.body);
  return out.join('\n') + '\n';
}

const NOTE_HEADING: Record<FeedbackRow['kind'], string> = {
  bug: '# A bug report',
  feature: '# A feature request',
  like: '# A like: something that works and should be kept',
};

/**
 * A bug report, a feature request or a like as it stands.
 *
 * The resolution note is the half a question is usually about: it holds what a
 * run said when it stopped, which on a blocked note is the question it is
 * waiting on. The page path says where the person was standing when they filed
 * it, which is often the whole of what the sentence leaves out.
 */
export function noteContext(note: FeedbackRow): string {
  const out = [
    NOTE_HEADING[note.kind] ?? '# A feature request',
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

/** The spec the change's diff reads against, when it is more than a few sections. */
const MAX_SPEC_CONTEXT = 12000;

/**
 * A proposed change to a spec (plan #1507): its title, its why and its diff,
 * with the sections of the spec the diff touches.
 *
 * The sections are there for two things a diff alone cannot answer: what the
 * rule around the change says, and the exact wording a reworded diff has to
 * keep on its context lines. Only the touched sections, for the reason
 * `specContext` gives; the whole document when none can be told apart, cut to
 * a length a cheap call can carry.
 */
export function specChangeContext(change: {
  title: string;
  why: string;
  diff: string;
  status: string;
  madeBy: 'me' | 'claude';
  /** The spec's title and file, or null for a spec the change creates. */
  spec: { title: string; file: string } | null;
  slug: string;
  /** The touched sections, as `## heading` and body, or the document when none matched. */
  sections: readonly { heading: string; body: string }[];
}): string {
  const out = [
    `# A proposed change to a spec — ${change.title}`,
    '',
    change.spec
      ? `To ${change.spec.title}, which is \`docs/${change.spec.file}\` in the repository.`
      : `To a new spec, ${change.slug}, which does not exist yet.`,
    `Status: ${change.status}`,
    `Drafted by: ${change.madeBy === 'claude' ? 'a session' : 'the person'}`,
    '',
    '## Why',
    '',
    change.why,
    '',
    '## The diff',
    '',
    change.diff.trimEnd(),
  ];
  if (change.sections.length > 0) {
    out.push('', '## The spec where it changes, as it stands');
    let used = 0;
    for (const section of change.sections) {
      const text = `## ${section.heading}\n\n${section.body}`;
      if (used + text.length > MAX_SPEC_CONTEXT) {
        if (used === 0) out.push('', text.slice(0, MAX_SPEC_CONTEXT));
        out.push('', '(The rest of the spec is left out for length.)');
        break;
      }
      out.push('', text);
      used += text.length;
    }
  }
  return out.join('\n') + '\n';
}
