/**
 * The guided essay (docs/LEARN-ESSAYS-SPEC.md, "The stages").
 *
 * Between the interview and the draft the person works the essay out in
 * stages: what Dash makes of the brief, the research, a plan of points, the
 * shape those points take, and each point dug into one question at a time.
 * Everything they write along the way is kept in `learn.essays.plan`, in
 * their own words; Dash contributes only questions, notes and the names of
 * shapes, which are labelled as Dash's wherever they are shown.
 *
 * This file names that jsonb's shape, reads it, and makes each change to it
 * as a pure function from the stored value to the next one, so the actions
 * stay thin and the rules can be tested. Nothing here touches the database
 * or the network.
 */

import type { EssayBrief, EssayInterview } from './model';
import { NOTES_MAX, readNoteMap, type NoteMap } from './notebook';

export const STAGES = ['discover', 'research', 'plan', 'structure', 'develop', 'write'] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_LABELS: Record<Stage, string> = {
  discover: 'Discover',
  research: 'Research',
  plan: 'Plan',
  structure: 'Structure',
  develop: 'Develop',
  write: 'Write',
};

/** What each stage is for, in a line, under the stepper. */
export const STAGE_AIMS: Record<Stage, string> = {
  discover: 'Find the question you are answering and what you think the answer is.',
  research: 'See what others say before you settle on your own view.',
  plan: 'Say your answer in one sentence and list the points that would convince a reader.',
  structure: 'Put the points in an order that carries the reader to your answer.',
  develop: 'Work out each point: why it is true, an example, and what a doubter would say.',
  write: 'Write it, a section at a time, with your plan beside you.',
};

export const ROLES = ['opening', 'point', 'objection', 'closing'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  opening: 'Opening',
  point: 'Point',
  objection: 'Objection',
  closing: 'Closing',
};

/** One of Dash's notes on the brief, with the person's reply to it. */
export type ReadbackNote = { body: string; reply: string };

export type Readback = {
  notes: ReadbackNote[];
  /** Narrower versions of the question, for the person to take, change or ignore. */
  sharper: string[];
  at: string;
};

/** A question Dash asked about a point, and the answer the person gave. */
export type PointNote = { ask: string; answer: string; kind: DigKind | null };

/** The kinds of question Dash asks about a point, one at a time. */
export const DIG_KINDS = ['why', 'example', 'evidence', 'doubt', 'reader', 'link'] as const;
export type DigKind = (typeof DIG_KINDS)[number];

export const DIG_LABELS: Record<DigKind, string> = {
  why: 'Why is it true?',
  example: 'An example',
  evidence: 'What shows it',
  doubt: 'What a doubter says',
  reader: 'Why the reader cares',
  link: 'How it connects',
};

/** The kind of question each kind asks, as Dash is told it. */
export const DIG_ASKS: Record<DigKind, string> = {
  why: 'why the point is true: the reason or mechanism behind it',
  example: 'one concrete example or case that shows the point, ideally from their own experience',
  evidence: 'what evidence, source or figure would show a sceptical reader the point holds',
  doubt:
    'the strongest objection someone who disagrees would raise against this point, and how they would answer it',
  reader: 'why the reader named in the brief should care about this point',
  link: 'how this point follows from the one before it, or leads to their answer',
};

/** The order the questions come in, by the part's role. */
const DIG_ORDER: Record<Role, readonly DigKind[]> = {
  opening: ['reader', 'example', 'link'],
  point: ['why', 'example', 'evidence', 'doubt', 'link'],
  objection: ['doubt', 'evidence', 'link'],
  closing: ['reader', 'link', 'why'],
};

export type PlanPoint = {
  id: string;
  /** The point in the person's words. Empty for a part a shape set out that they have not filled yet. */
  text: string;
  role: Role;
  /** What this part of the essay does, from the shape they chose. Dash's words. */
  guide: string;
  notes: PointNote[];
  /** The question Dash is asking about this point now, or null. */
  asking: { kind: DigKind; ask: string } | null;
  /** True once they say they have enough to write it. */
  ready: boolean;
  /** What Dash found on the web for this point, each with the person's take on it. */
  evidence: PointEvidence[];
};

/**
 * What a piece of evidence does for a point: the rule or standard the reader
 * answers to, evidence for the point, the strongest case against it, or a
 * real case that shows it (LEARN-ESSAYS-SPEC, "Evidence on a point").
 */
export const EVIDENCE_KINDS = ['rule', 'for', 'against', 'case'] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

/** Who published a source, as Dash labelled it and the address confirms. */
export const SOURCE_TYPES = [
  'regulator',
  'standard-setter',
  'research',
  'professional body',
  'firm',
  'press',
  'vendor',
] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export type PointEvidence = {
  id: string;
  kind: EvidenceKind;
  sourceType: SourceType;
  /** Dash's one-line headline and sentence or two, from the source. */
  title: string;
  summary: string;
  /** The words the API's citation located on the page. */
  quote: string;
  url: string;
  sourceTitle: string;
  domain: string;
  /** What the person makes of it, in their words. */
  take: string;
};

/** The most evidence kept on one point. */
export const POINT_EVIDENCE_MAX = 8;

export type PlanNoteStatus = 'open' | 'done';
export type PlanNote = { id: string; body: string; status: PlanNoteStatus };

/** Evidence found for one cluster of the notes map, kept until it is added to the notes or dropped. */
export type ClusterFind = { label: string; items: PointEvidence[] };

export type EssayPlan = {
  /** The notes page, in the person's words (LEARN-ESSAYS-SPEC, "Notes first"). Empty until first saved. */
  notes: string;
  /** Dash's map of the notes, from the last press of Update the map. */
  noteMap: NoteMap | null;
  /** Dash's model draft, shown beside the essay and never put into it. */
  modelDraft: { text: string; at: string } | null;
  /** Evidence found for clusters of the map. */
  found: ClusterFind[];
  thesis: string;
  readback: Readback | null;
  /** What the person made of each part of the research, keyed `<run id>:<part>`. */
  takes: Record<string, string>;
  points: PlanPoint[];
  shape: string | null;
  review: PlanNote[];
};

export const EMPTY_PLAN: EssayPlan = {
  notes: '',
  noteMap: null,
  modelDraft: null,
  found: [],
  thesis: '',
  readback: null,
  takes: {},
  points: [],
  shape: null,
  review: [],
};

/** The longest thesis kept, about two sentences. */
export const THESIS_MAX = 400;
/** The longest point kept. */
export const POINT_MAX = 400;
/** The longest answer or take kept, about a paragraph. */
export const NOTE_MAX = 1_500;
export const POINTS_MAX = 12;
export const POINT_NOTES_MAX = 8;
export const READBACK_NOTES_MAX = 3;
export const SHARPER_MAX = 3;
export const REVIEW_MAX = 3;

function text(value: unknown, max = 4_000): string {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function list(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(object) : [];
}

function readRole(value: unknown): Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value)
    ? (value as Role)
    : 'point';
}

function readKind(value: unknown): DigKind | null {
  return typeof value === 'string' && (DIG_KINDS as readonly string[]).includes(value)
    ? (value as DigKind)
    : null;
}

function readReadback(value: unknown): Readback | null {
  const raw = object(value);
  const notes = list(raw.notes)
    .map((n) => ({ body: text(n.body), reply: text(n.reply, NOTE_MAX) }))
    .filter((n) => n.body.trim())
    .slice(0, READBACK_NOTES_MAX);
  const sharper = (Array.isArray(raw.sharper) ? raw.sharper : [])
    .map((s) => text(s, 300).trim())
    .filter(Boolean)
    .slice(0, SHARPER_MAX);
  if (notes.length === 0 && sharper.length === 0) return null;
  return { notes, sharper, at: text(raw.at) };
}

function readPoint(raw: Record<string, unknown>): PlanPoint | null {
  const id = text(raw.id, 64);
  if (!id) return null;
  const asking = object(raw.asking);
  const kind = readKind(asking.kind);
  return {
    id,
    text: text(raw.text, POINT_MAX),
    role: readRole(raw.role),
    guide: text(raw.guide, 400),
    notes: list(raw.notes)
      .map((n) => ({
        ask: text(n.ask, 400),
        answer: text(n.answer, NOTE_MAX),
        kind: readKind(n.kind),
      }))
      .filter((n) => n.ask.trim())
      .slice(0, POINT_NOTES_MAX),
    asking: kind && text(asking.ask).trim() ? { kind, ask: text(asking.ask, 400) } : null,
    ready: raw.ready === true,
    evidence: list(raw.evidence)
      .map(readEvidence)
      .filter((e): e is PointEvidence => e !== null)
      .slice(0, POINT_EVIDENCE_MAX),
  };
}

function readEvidence(raw: Record<string, unknown>): PointEvidence | null {
  const kind = raw.kind;
  const type = raw.sourceType;
  const url = text(raw.url, 2_000);
  if (!(EVIDENCE_KINDS as readonly unknown[]).includes(kind) || !/^https?:\/\//.test(url))
    return null;
  return {
    id: text(raw.id, 64),
    kind: kind as EvidenceKind,
    sourceType: (SOURCE_TYPES as readonly unknown[]).includes(type)
      ? (type as SourceType)
      : 'press',
    title: text(raw.title, 200),
    summary: text(raw.summary, 600),
    quote: text(raw.quote, 600),
    url,
    sourceTitle: text(raw.sourceTitle, 300),
    domain: text(raw.domain, 200),
    take: text(raw.take, NOTE_MAX),
  };
}

/** The plan from its jsonb, with anything missing or of the wrong type read as empty. */
export function readPlan(value: unknown): EssayPlan {
  const raw = object(value);
  const takes: Record<string, string> = {};
  for (const [key, take] of Object.entries(object(raw.takes))) {
    const kept = text(take, NOTE_MAX);
    if (key.length <= 120 && kept.trim()) takes[key] = kept;
  }
  const seen = new Set<string>();
  const points: PlanPoint[] = [];
  for (const item of list(raw.points)) {
    const point = readPoint(item);
    if (!point || seen.has(point.id)) continue;
    seen.add(point.id);
    points.push(point);
    if (points.length === POINTS_MAX) break;
  }
  const draft = object(raw.modelDraft);
  const found = list(raw.found)
    .map((f) => ({
      label: text(f.label, 120),
      items: list(f.items)
        .map(readEvidence)
        .filter((e): e is PointEvidence => e !== null)
        .slice(0, 6),
    }))
    .filter((f) => f.label && f.items.length)
    .slice(0, 12);
  return {
    notes: text(raw.notes, NOTES_MAX),
    noteMap: readNoteMap(raw.noteMap),
    modelDraft: text(draft.text, 40_000).trim()
      ? { text: text(draft.text, 40_000), at: text(draft.at, 40) }
      : null,
    found,
    thesis: text(raw.thesis, THESIS_MAX),
    readback: readReadback(raw.readback),
    takes,
    points,
    shape: text(raw.shape, 120).trim() || null,
    review: list(raw.review)
      .map((n) => ({
        id: text(n.id, 64),
        body: text(n.body, 600),
        status: (n.status === 'done' ? 'done' : 'open') as PlanNoteStatus,
      }))
      .filter((n) => n.id && n.body.trim())
      .slice(0, REVIEW_MAX * 3),
  };
}

/** The plan as it is stored. Everything goes through readPlan first, so what is written is always clean. */
export function planJson(plan: EssayPlan): Record<string, unknown> {
  return {
    notes: plan.notes,
    noteMap: plan.noteMap,
    modelDraft: plan.modelDraft,
    found: plan.found,
    thesis: plan.thesis,
    readback: plan.readback,
    takes: plan.takes,
    points: plan.points,
    shape: plan.shape,
    review: plan.review,
  };
}

/** A short id for a point or a note, unique within the plan. */
export function newId(taken: Iterable<string>, prefix = 'p'): string {
  const used = new Set(taken);
  for (let n = 1; ; n += 1) {
    const id = `${prefix}${n}`;
    if (!used.has(id)) return id;
  }
}

function clean(value: string, max: number): string {
  return value.trim().slice(0, max);
}

// ---------------------------------------------------------------------------
// Changes, each from one plan to the next
// ---------------------------------------------------------------------------

export function withThesis(plan: EssayPlan, thesis: string): EssayPlan {
  return { ...plan, thesis: clean(thesis, THESIS_MAX) };
}

export function withReadback(
  plan: EssayPlan,
  notes: string[],
  sharper: string[],
  at: string,
): EssayPlan {
  return {
    ...plan,
    readback: {
      notes: notes.slice(0, READBACK_NOTES_MAX).map((body) => ({ body, reply: '' })),
      sharper: sharper.slice(0, SHARPER_MAX),
      at,
    },
  };
}

export function withReadbackReply(plan: EssayPlan, index: number, reply: string): EssayPlan {
  if (!plan.readback || !plan.readback.notes[index]) return plan;
  const notes = plan.readback.notes.map((n, i) =>
    i === index ? { ...n, reply: clean(reply, NOTE_MAX) } : n,
  );
  return { ...plan, readback: { ...plan.readback, notes } };
}

export function withTake(plan: EssayPlan, key: string, take: string): EssayPlan {
  const takes = { ...plan.takes };
  const kept = clean(take, NOTE_MAX);
  if (kept) takes[key.slice(0, 120)] = kept;
  else delete takes[key];
  return { ...plan, takes };
}

/** A new point at the end, in the person's words. A blank point, or one already there, changes nothing. */
export function withPoint(plan: EssayPlan, words: string, role: Role = 'point'): EssayPlan {
  const kept = clean(words, POINT_MAX);
  if (!kept || plan.points.length >= POINTS_MAX) return plan;
  if (plan.points.some((p) => squash(p.text) === squash(kept))) return plan;
  const id = newId(plan.points.map((p) => p.id));
  return {
    ...plan,
    points: [
      ...plan.points,
      { id, text: kept, role, guide: '', notes: [], asking: null, ready: false, evidence: [] },
    ],
  };
}

export function editedPoint(
  plan: EssayPlan,
  id: string,
  change: { text?: string; role?: Role; ready?: boolean },
): EssayPlan {
  return {
    ...plan,
    points: plan.points.map((p) =>
      p.id !== id
        ? p
        : {
            ...p,
            ...(change.text !== undefined ? { text: clean(change.text, POINT_MAX) } : {}),
            ...(change.role ? { role: change.role } : {}),
            ...(change.ready !== undefined
              ? { ready: change.ready, asking: change.ready ? null : p.asking }
              : {}),
          },
    ),
  };
}

export function withoutPoint(plan: EssayPlan, id: string): EssayPlan {
  return { ...plan, points: plan.points.filter((p) => p.id !== id) };
}

/** One point moved up (-1) or down (+1). */
export function movedPoint(plan: EssayPlan, id: string, by: -1 | 1): EssayPlan {
  const at = plan.points.findIndex((p) => p.id === id);
  const to = at + by;
  if (at < 0 || to < 0 || to >= plan.points.length) return plan;
  const points = [...plan.points];
  [points[at], points[to]] = [points[to]!, points[at]!];
  return { ...plan, points };
}

/** The question Dash is now asking about a point. */
export function withAsking(plan: EssayPlan, id: string, kind: DigKind, ask: string): EssayPlan {
  return {
    ...plan,
    points: plan.points.map((p) =>
      p.id === id ? { ...p, asking: { kind, ask: clean(ask, 400) }, ready: false } : p,
    ),
  };
}

/** The person's answer to the question being asked about a point, kept under it. A blank answer skips it. */
export function answeredPoint(plan: EssayPlan, id: string, answer: string): EssayPlan {
  return {
    ...plan,
    points: plan.points.map((p) => {
      if (p.id !== id || !p.asking) return p;
      const kept = clean(answer, NOTE_MAX);
      const notes = kept
        ? [...p.notes, { ask: p.asking.ask, answer: kept, kind: p.asking.kind }].slice(
            -POINT_NOTES_MAX,
          )
        : p.notes;
      return { ...p, notes, asking: null };
    }),
  };
}

/** One answer under a point, edited where it is read. An emptied answer is removed. */
export function editedPointNote(
  plan: EssayPlan,
  id: string,
  index: number,
  answer: string,
): EssayPlan {
  return {
    ...plan,
    points: plan.points.map((p) => {
      if (p.id !== id || !p.notes[index]) return p;
      const kept = clean(answer, NOTE_MAX);
      const notes = kept
        ? p.notes.map((n, i) => (i === index ? { ...n, answer: kept } : n))
        : p.notes.filter((_, i) => i !== index);
      return { ...p, notes };
    }),
  };
}

/**
 * The next kind of question to ask about a point: the first in its role's
 * order not yet asked, then round again. `chosen` overrides it when the
 * person picked a kind.
 */
export function nextDigKind(
  point: Pick<PlanPoint, 'role' | 'notes'>,
  chosen?: DigKind | null,
): DigKind {
  if (chosen) return chosen;
  const asked = point.notes.map((n) => n.kind);
  const order = DIG_ORDER[point.role];
  return order.find((kind) => !asked.includes(kind)) ?? order[point.notes.length % order.length]!;
}

/** A part of a shape: its role, what it does, and which of the person's points go in it. */
export type ShapePart = { role: Role; guide: string; points: string[] };
export type Shape = { name: string; why: string; parts: ShapePart[] };

/**
 * The plan rearranged into a shape. Each part takes the points the shape put
 * in it, in order, with the part's role and guide. A part with no point
 * becomes an empty slot for the person to fill. Points the shape left out
 * keep their place after the rest, so nothing they wrote is lost.
 */
export function shapedPlan(plan: EssayPlan, shape: Shape): EssayPlan {
  const byId = new Map(plan.points.map((p) => [p.id, p]));
  const placed = new Set<string>();
  const out: PlanPoint[] = [];
  const taken = plan.points.map((p) => p.id);
  for (const part of shape.parts) {
    const ids = part.points.filter((id) => byId.has(id) && !placed.has(id));
    if (ids.length === 0) {
      const id = newId([...taken, ...out.map((p) => p.id)]);
      out.push({
        id,
        text: '',
        role: part.role,
        guide: part.guide,
        notes: [],
        asking: null,
        ready: false,
        evidence: [],
      });
      continue;
    }
    for (const id of ids) {
      placed.add(id);
      out.push({ ...byId.get(id)!, role: part.role, guide: part.guide });
    }
  }
  for (const point of plan.points) if (!placed.has(point.id)) out.push(point);
  return { ...plan, shape: shape.name, points: out.slice(0, POINTS_MAX) };
}

export function withReview(plan: EssayPlan, bodies: string[]): EssayPlan {
  const kept = plan.review.filter((n) => n.status === 'open');
  const ids = [...plan.review.map((n) => n.id)];
  const fresh = bodies.slice(0, REVIEW_MAX).map((body) => {
    const id = newId(ids, 'r');
    ids.push(id);
    return { id, body, status: 'open' as const };
  });
  return {
    ...plan,
    review: [...fresh, ...kept.filter((n) => !bodies.includes(n.body))].slice(0, REVIEW_MAX * 3),
  };
}

export function closedReview(plan: EssayPlan, id: string): EssayPlan {
  return { ...plan, review: plan.review.map((n) => (n.id === id ? { ...n, status: 'done' } : n)) };
}

// ---------------------------------------------------------------------------
// Where the essay has got to
// ---------------------------------------------------------------------------

/** How far each stage has got, for the stepper's marks. */
export function stageDone(input: {
  brief: EssayBrief;
  interview: EssayInterview | null;
  plan: EssayPlan;
  researched: boolean;
  words: number;
}): Record<Stage, boolean> {
  const { brief, interview, plan } = input;
  const filled = plan.points.filter((p) => p.text.trim());
  return {
    discover:
      interview?.status !== 'asking' && Boolean(brief.question.trim() && brief.claim.trim()),
    research: input.researched || Object.keys(plan.takes).length > 0,
    plan: Boolean(plan.thesis.trim()) && filled.length >= 2,
    structure: Boolean(plan.shape) && filled.length >= 2 && filled.length === plan.points.length,
    develop: filled.length > 0 && filled.every((p) => p.ready || p.notes.length >= 2),
    write: input.words >= 200,
  };
}

/**
 * The stage an essay opens on: the interview while it is asking, the draft
 * once there is one, and otherwise the first stage not done yet.
 */
export function openingStage(
  done: Record<Stage, boolean>,
  interviewAsking: boolean,
  words: number,
): Stage {
  if (interviewAsking) return 'discover';
  if (words >= 150) return 'write';
  return STAGES.find((stage) => !done[stage]) ?? 'write';
}

export function readStage(value: unknown): Stage | null {
  return typeof value === 'string' && (STAGES as readonly string[]).includes(value)
    ? (value as Stage)
    : null;
}

export function nextStage(stage: Stage): Stage | null {
  return STAGES[STAGES.indexOf(stage) + 1] ?? null;
}

// ---------------------------------------------------------------------------
// From the plan to the draft
// ---------------------------------------------------------------------------

function squash(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * The outline as headings for an empty draft: the title line, then one
 * heading per point in the person's words, with a blank line under each to
 * write into. Points with no words yet are left out. Nothing of Dash's goes
 * into the draft: the guides and questions stay in the plan.
 */
export function outlineDraft(plan: EssayPlan, title: string): string {
  const lines = [`# ${title.trim() || 'Untitled essay'}`, ''];
  for (const point of plan.points) {
    const words = point.text.replace(/\s+/g, ' ').trim();
    if (!words) continue;
    lines.push(`## ${words}`, '', '');
  }
  return lines.join('\n');
}

/**
 * The point whose heading the caret is under, found by matching the nearest
 * heading above it with a point's words. Null when no heading matches.
 */
export function pointAtHeading(plan: EssayPlan, heading: string | null): PlanPoint | null {
  if (!heading) return null;
  const want = squash(heading);
  return plan.points.find((p) => p.text.trim() && squash(p.text) === want) ?? null;
}

/** The nearest `#`-heading at or above a position in the draft, without its hashes. */
export function headingAbove(doc: string, at: number): string | null {
  const lineEnd = doc.indexOf('\n', Math.max(0, at));
  const lines = (lineEnd < 0 ? doc : doc.slice(0, lineEnd)).split('\n');
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const match = /^#{2,6}\s+(.+?)\s*#*\s*$/.exec(lines[i]!);
    if (match) return match[1]!;
  }
  return null;
}

/**
 * The person's own writing so far that points can be drawn from: their
 * answers in the brief and their takes on the research, each labelled. Find
 * points reads this, and keeps only passages that appear in it word for word.
 */
export function ownWords(brief: EssayBrief, plan: EssayPlan): { label: string; text: string }[] {
  const out: { label: string; text: string }[] = [];
  if (brief.claim.trim()) out.push({ label: 'Your answer', text: brief.claim });
  if (brief.origin.trim()) out.push({ label: 'What made you think it', text: brief.origin });
  if (brief.change.trim()) out.push({ label: 'What would change your mind', text: brief.change });
  if (plan.thesis.trim()) out.push({ label: 'Your thesis', text: plan.thesis });
  for (const note of plan.readback?.notes ?? []) {
    if (note.reply.trim()) out.push({ label: 'Your reply to Dash', text: note.reply });
  }
  for (const take of Object.values(plan.takes))
    out.push({ label: 'Your take on the research', text: take });
  return out;
}

/** True when `passage` appears in one of `sources` word for word, ignoring spacing and case. */
export function isOwnWords(passage: string, sources: readonly { text: string }[]): boolean {
  const want = squash(passage).replace(/^["“'‘]+|["”'’.]+$/g, '');
  if (want.length < 12) return false;
  return sources.some((s) => squash(s.text).includes(want));
}

// ---------------------------------------------------------------------------
// Evidence on a point
// ---------------------------------------------------------------------------

/**
 * New evidence on a point, after what is there. An item whose page and quote
 * the point already has is skipped, and the oldest items go when the point
 * is full.
 */
export function withEvidence(
  plan: EssayPlan,
  pointId: string,
  items: Omit<PointEvidence, 'id'>[],
): EssayPlan {
  return {
    ...plan,
    points: plan.points.map((p) => {
      if (p.id !== pointId) return p;
      const evidence = [...p.evidence];
      for (const item of items) {
        if (evidence.some((e) => e.url === item.url && e.quote === item.quote)) continue;
        evidence.push({
          ...item,
          id: newId(
            evidence.map((e) => e.id),
            'e',
          ),
        });
      }
      return { ...p, evidence: evidence.slice(-POINT_EVIDENCE_MAX) };
    }),
  };
}

export function withoutEvidence(plan: EssayPlan, pointId: string, evidenceId: string): EssayPlan {
  return {
    ...plan,
    points: plan.points.map((p) =>
      p.id === pointId ? { ...p, evidence: p.evidence.filter((e) => e.id !== evidenceId) } : p,
    ),
  };
}

export function withEvidenceTake(
  plan: EssayPlan,
  pointId: string,
  evidenceId: string,
  take: string,
): EssayPlan {
  return {
    ...plan,
    points: plan.points.map((p) =>
      p.id === pointId
        ? {
            ...p,
            evidence: p.evidence.map((e) =>
              e.id === evidenceId ? { ...e, take: clean(take, NOTE_MAX) } : e,
            ),
          }
        : p,
    ),
  };
}

// ---------------------------------------------------------------------------
// The argument as it stands
// ---------------------------------------------------------------------------

export type ArgumentGap =
  | 'no-thesis'
  | 'no-points'
  | 'unsupported'
  | 'no-objection'
  | 'too-many-sources'
  | 'vendor-heavy';

export type ArgumentReason = {
  id: string;
  text: string;
  role: Role;
  notes: number;
  /** Evidence on the point, counted by what it does. */
  counts: Record<EvidenceKind, number>;
  /** True with a rule, a piece of evidence, a case, or two answers of the person's own about it. */
  supported: boolean;
};

export type ArgumentMap = {
  thesis: string;
  reasons: ArgumentReason[];
  /** True when a point is an objection, or evidence against a point is on file. */
  objection: boolean;
  /** Distinct sites the evidence comes from, and how many are vendors. */
  sources: number;
  vendors: number;
  gaps: ArgumentGap[];
};

/** Practitioner essays of this length cite about three outside sources at most. */
export const SOURCES_AIM = 4;

/**
 * The plan read as an argument (Booth, Colomb and Williams): the claim, each
 * reason with what supports it, and whether the strongest objection is
 * there. The gaps are what the Develop step points at first.
 */
export function argumentMap(plan: EssayPlan): ArgumentMap {
  const reasons = plan.points
    .filter((p) => p.text.trim())
    .map((p) => {
      const counts = { rule: 0, for: 0, against: 0, case: 0 } as Record<EvidenceKind, number>;
      for (const e of p.evidence) counts[e.kind] += 1;
      const answered = p.notes.filter((n) => n.answer.trim()).length;
      return {
        id: p.id,
        text: p.text.trim(),
        role: p.role,
        notes: answered,
        counts,
        supported: counts.rule + counts.for + counts.case > 0 || answered >= 2,
      };
    });
  const all = plan.points.flatMap((p) => p.evidence);
  const domains = new Map<string, SourceType>();
  for (const e of all) domains.set(e.domain || e.url, e.sourceType);
  const vendors = [...domains.values()].filter((t) => t === 'vendor').length;
  const objection =
    plan.points.some((p) => p.role === 'objection' && p.text.trim()) ||
    all.some((e) => e.kind === 'against');
  const gaps: ArgumentGap[] = [];
  if (!plan.thesis.trim()) gaps.push('no-thesis');
  if (reasons.length === 0) gaps.push('no-points');
  if (reasons.some((r) => !r.supported)) gaps.push('unsupported');
  if (!objection) gaps.push('no-objection');
  if (domains.size > SOURCES_AIM) gaps.push('too-many-sources');
  if (vendors > 0 && vendors * 2 >= domains.size) gaps.push('vendor-heavy');
  return { thesis: plan.thesis.trim(), reasons, objection, sources: domains.size, vendors, gaps };
}
