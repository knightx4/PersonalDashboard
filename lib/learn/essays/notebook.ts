/**
 * The notes-first essay (docs/LEARN-ESSAYS-SPEC.md, "Notes first").
 *
 * The person only writes. They put their raw thoughts on one notes page;
 * Dash keeps a map of those notes when they press Update the map: the claims
 * they seem to be arguing, the clusters of things they keep circling, the
 * tensions between notes, the gaps, a suggested order, and a few questions.
 * Every claim and cluster is shown through the person's own sentences, kept
 * only when they appear in the notes word for word. They correct the map by
 * writing more notes, never by editing it.
 *
 * Two ways to a draft: Assemble, which lays the person's own passages out in
 * the map's order under Dash's headings with the gaps marked, and a model
 * draft, which Dash writes from the notes and which is shown beside the
 * essay as Dash's, never put into it.
 *
 * Why: the owner writes by discovery (Galbraith 1999, 2009; Elbow): ideas
 * form while producing text, and structure appears late. The six planning
 * stages made them do a planner's bookkeeping by hand. Nothing here touches
 * the database or the network.
 */

import type { AuthorMark } from './authorship';
import type { EssayBrief } from './model';
import type { EssayPlan } from './plan';

/** True when `passage` appears in one of `sources` word for word, ignoring spacing, case and wrapping quotes. */
export function isOwnWords(passage: string, sources: readonly { text: string }[]): boolean {
  const flat = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
  const want = flat(passage).replace(/^["“'‘]+|["”'’.]+$/g, '');
  if (want.length < 12) return false;
  return sources.some((s) => flat(s.text).includes(want));
}

/** The longest notes page kept, about 15,000 words. */
export const NOTES_MAX = 100_000;
export const CLUSTERS_MAX = 7;
export const QUESTIONS_MAX = 3;

export type MapCluster = {
  id: string;
  /** Dash's short name for what the notes keep circling. */
  label: string;
  /** The person's own passages that make up the cluster, in their order of strength. */
  quotes: string[];
  /** How well the notes hold it up. */
  support: 'none' | 'thin' | 'ok';
  /** What is missing, in a sentence, when support is not ok. */
  gap: string;
};

export type NoteMap = {
  at: string;
  /** Claims the notes seem to argue, each in the person's own sentence. */
  claims: string[];
  /** Clusters in the suggested order. */
  clusters: MapCluster[];
  /** Two passages that pull against each other, and Dash's line on why. */
  tensions: { a: string; b: string; note: string }[];
  questions: string[];
  /** True when there is enough in the notes to suggest an order. */
  ordered: boolean;
};

function text(value: unknown, max = 4_000): string {
  return typeof value === 'string' ? value.slice(0, max) : '';
}
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function strings(value: unknown, max: number, each = 600): string[] {
  return (Array.isArray(value) ? value : [])
    .map((v) => text(v, each).trim())
    .filter(Boolean)
    .slice(0, max);
}

/** The map from its jsonb, with anything malformed dropped. */
export function readNoteMap(value: unknown): NoteMap | null {
  const raw = object(value);
  if (!raw.at) return null;
  const clusters = (Array.isArray(raw.clusters) ? raw.clusters : []).map(object).flatMap((c, i) => {
    const label = text(c.label, 120).trim();
    if (!label) return [];
    const support = c.support === 'none' || c.support === 'thin' ? c.support : 'ok';
    return [
      {
        id: text(c.id, 32) || `c${i + 1}`,
        label,
        quotes: strings(c.quotes, 8),
        support,
        gap: text(c.gap, 300),
      } as MapCluster,
    ];
  });
  return {
    at: text(raw.at, 40),
    claims: strings(raw.claims, 3),
    clusters: clusters.slice(0, CLUSTERS_MAX),
    tensions: (Array.isArray(raw.tensions) ? raw.tensions : [])
      .map(object)
      .map((t) => ({ a: text(t.a, 600), b: text(t.b, 600), note: text(t.note, 300) }))
      .filter((t) => t.a && t.b)
      .slice(0, 3),
    questions: strings(raw.questions, QUESTIONS_MAX, 300),
    ordered: raw.ordered === true,
  };
}

function squash(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * The notes an essay starts with when it has none yet: everything the person
 * already wrote for it, under plain labels, so nothing written in the old
 * stages is lost.
 */
export function seedNotes(brief: EssayBrief, plan: EssayPlan): string {
  const parts: string[] = [];
  const add = (label: string, body: string) => {
    if (body.trim()) parts.push(`## ${label}\n\n${body.trim()}`);
  };
  add('What I think', brief.claim);
  add('What made me think it', brief.origin);
  add('What would change my mind', brief.change);
  add('Thesis', plan.thesis);
  for (const note of plan.readback?.notes ?? []) {
    if (note.reply.trim()) add(`Dash asked: ${note.body}`, note.reply);
  }
  const points = plan.points.filter((p) => p.text.trim());
  if (points.length)
    parts.push(`## Points\n\n${points.map((p) => `- ${p.text.trim()}`).join('\n')}`);
  for (const p of points) {
    for (const n of p.notes) if (n.answer.trim()) add(`Dash asked: ${n.ask}`, n.answer);
  }
  for (const take of Object.values(plan.takes)) add('On the research', take);
  return parts.join('\n\n');
}

/** The notes as they are: what was saved, or the seed when nothing was. */
export function notesOf(brief: EssayBrief, plan: EssayPlan): string {
  return plan.notes?.trim() ? plan.notes : seedNotes(brief, plan);
}

/** An answer to one of Dash's questions, as it is added to the end of the notes. */
export function answerBlock(question: string, answer: string): string {
  return `\n\n## Dash asked: ${squash(question)}\n\n${answer.trim()}\n`;
}

/** A source as it is added to the end of the notes: the quoted words and where they come from. */
export function sourceBlock(source: {
  quote: string;
  sourceTitle: string;
  domain: string;
  url: string;
}): string {
  const quote = squash(source.quote).replace(/"/g, '”');
  return `\n\n> “${quote}”\n> ${source.sourceTitle || source.domain} · ${source.url}\n`;
}

// ---------------------------------------------------------------------------
// The map call
// ---------------------------------------------------------------------------

export const MAP_NOTES_SYSTEM = `You are Dash, reading someone's raw notes for a short essay they will write
themselves. They write by discovery: they put down everything they think,
out of order, and find the argument as they go. Your job is to show them
what is in their notes so far, so they can keep writing. You never write
any of their essay.

Read all the notes. Reply with one JSON object and nothing else, in this
shape:

{
  "claims": ["..."],
  "clusters": [{"label": "...", "quotes": ["..."], "support": "none|thin|ok", "gap": "..."}],
  "tensions": [{"a": "...", "b": "...", "note": "..."}],
  "questions": ["..."],
  "ordered": true
}

- claims: one to three sentences from the notes that each state something a
  reader could dispute and that the rest of the notes could be built around,
  strongest first.
- clusters: the three to ${CLUSTERS_MAX} things the notes keep returning to. "label" is your
  name for it, under eight words, in plain language. "quotes" are one to five
  passages from the notes that belong to it, strongest first. "support" says
  how well the notes hold it up: "none" for bare assertion, "thin" for one
  reason or example, "ok" for reasons, a concrete case or a source. "gap" is
  one sentence on what is missing, empty when support is ok. Put the clusters
  in the order an essay could take them, the one that sets up the others
  first.
- tensions: up to three pairs of passages that pull against each other, with
  one sentence on why. Leave it empty if there are none.
- questions: one to ${QUESTIONS_MAX} questions that would most move the notes forward,
  aimed at the biggest tension or gap, each one sentence ending in a question
  mark, built on their words. No praise.
- ordered: false when the notes are too thin to suggest an order yet.

Every passage in "claims", "quotes", "a" and "b" must be copied from the notes
exactly, character for character, typos included: a phrase or a sentence,
at most about forty words. A passage not found word for word in the notes is
thrown away. If you were given the previous map, keep a cluster's label when
it still fits, so the map does not churn.`;

export function mapNotesPrompt(input: {
  question: string;
  reader: string;
  notes: string;
  previous: NoteMap | null;
}): string {
  const lines = [
    `The essay's question: ${input.question.trim() || '(not written yet)'}`,
    `Reader: ${input.reader.trim() || 'not said'}`,
  ];
  if (input.previous?.clusters.length) {
    lines.push(
      '',
      'Previous map labels, to keep where they still fit:',
      ...input.previous.clusters.map((c) => `- ${c.label}`),
    );
  }
  lines.push('', '<notes>', input.notes.trim(), '</notes>');
  return lines.join('\n');
}

/** The JSON object in a reply, fenced or bare. */
function jsonIn(reply: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(reply);
  const body = fenced ? fenced[1]! : reply.slice(reply.indexOf('{'), reply.lastIndexOf('}') + 1);
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

/**
 * The map from the reply: passages kept only when they are in the notes word
 * for word, clusters with no surviving passage dropped, and questions kept
 * only as single questions.
 */
export function readMapReply(reply: string, notes: string, at: string): NoteMap | null {
  const raw = object(jsonIn(reply));
  if (!raw.clusters && !raw.claims) return null;
  const sources = [{ text: notes }];
  const own = (passages: unknown, max: number) =>
    strings(passages, max).filter((p) => isOwnWords(p, sources));
  const clusters: MapCluster[] = [];
  for (const c of (Array.isArray(raw.clusters) ? raw.clusters : []).map(object)) {
    const label = squash(text(c.label, 120));
    const quotes = own(c.quotes, 5);
    if (!label || quotes.length === 0) continue;
    const support = c.support === 'none' || c.support === 'thin' ? c.support : 'ok';
    clusters.push({
      id: `c${clusters.length + 1}`,
      label,
      quotes,
      support,
      gap: support === 'ok' ? '' : squash(text(c.gap, 300)),
    });
    if (clusters.length === CLUSTERS_MAX) break;
  }
  const tensions = (Array.isArray(raw.tensions) ? raw.tensions : [])
    .map(object)
    .map((t) => ({
      a: text(t.a, 600).trim(),
      b: text(t.b, 600).trim(),
      note: squash(text(t.note, 300)),
    }))
    .filter((t) => isOwnWords(t.a, sources) && isOwnWords(t.b, sources))
    .slice(0, 3);
  const questions = strings(raw.questions, QUESTIONS_MAX * 2, 300)
    .filter(
      (q) =>
        q.endsWith('?') &&
        (q.match(/\?/g) ?? []).length === 1 &&
        !/\b(great|interesting|nice)\b/i.test(q),
    )
    .slice(0, QUESTIONS_MAX);
  if (clusters.length === 0) return null;
  return {
    at,
    claims: own(raw.claims, 3),
    clusters,
    tensions,
    questions,
    ordered: raw.ordered !== false,
  };
}

// ---------------------------------------------------------------------------
// From the notes to a draft
// ---------------------------------------------------------------------------

/**
 * A draft laid out from the person's own passages: a title, then each
 * cluster in the map's order as a heading with its passages as paragraphs,
 * and a gap line where the notes do not hold the cluster up. The headings and
 * gap lines are Dash's and carry Dash's mark, so "Your words" stays honest;
 * every other word is the person's.
 */
export function assembleDraft(
  map: NoteMap,
  title: string,
  model: string,
): { text: string; marks: AuthorMark[] } {
  let out = '';
  const marks: AuthorMark[] = [];
  const dash = (s: string) => {
    marks.push({ author: 'dash', from: out.length, to: out.length + s.length, name: model });
    out += s;
  };
  out += `# ${title.trim() || 'Untitled essay'}\n\n`;
  const lead = map.claims[0];
  if (lead) out += `${squash(lead)}\n\n`;
  for (const cluster of map.clusters) {
    out += '## ';
    dash(cluster.label);
    out += '\n\n';
    for (const quote of cluster.quotes) {
      if (lead && squash(quote) === squash(lead)) continue;
      out += `${squash(quote)}\n\n`;
    }
    if (cluster.support !== 'ok') {
      dash(`[Gap: ${cluster.gap || 'nothing holds this up yet'}]`);
      out += '\n\n';
    }
  }
  return { text: out.replace(/\n+$/, '\n'), marks };
}

export const MODEL_DRAFT_SYSTEM = `You are Dash, writing a model draft of a short essay from someone's raw
notes. The draft is a sparring partner: they will read it to see where their
argument could go, then write their own essay. It is never put into their
essay, so write it freely, but stay faithful to what their notes argue, use
their examples and experience rather than inventing new ones, and say
nothing their notes do not support. Where the notes leave a gap, write
"[gap: ...]" rather than filling it with claims of your own.

Plain English, short sentences, no headings unless the essay needs them, no
preamble. Aim for the length you are given.`;

export function modelDraftPrompt(input: {
  question: string;
  reader: string;
  target: number | null;
  notes: string;
}): string {
  return [
    `The essay's question: ${input.question.trim() || '(not written yet)'}`,
    `Reader: ${input.reader.trim() || 'a general reader'}`,
    `Length: about ${input.target ?? 800} words`,
    '',
    '<notes>',
    input.notes.trim(),
    '</notes>',
  ].join('\n');
}
