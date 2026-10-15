/**
 * What Dash says while the person works an essay out (docs/LEARN-ESSAYS-SPEC.md,
 * "The stages"): the prompts for each call and the readers of what comes
 * back. guide-model.ts makes the calls.
 *
 * Every call here guides; none writes the essay. Dash's output is questions,
 * short notes naming a problem, sharper versions of the question, the names
 * and purposes of an essay's parts, and passages lifted word for word from
 * what the person already wrote. Each reader drops anything that breaks
 * those limits, so a reply that drifts into prose is not shown.
 *
 * Nothing here touches the database or the network, so it is tested from
 * fixtures.
 */

import { PLAIN_ASKS } from './interview';
import { BRIEF_FIELDS, type EssayBrief } from './model';
import {
  DIG_ASKS,
  isOwnWords,
  READBACK_NOTES_MAX,
  REVIEW_MAX,
  ROLES,
  ROLE_LABELS,
  SHARPER_MAX,
  type DigKind,
  type EssayPlan,
  type PlanPoint,
  type Role,
  type Shape,
} from './plan';

const RULES = `HOW YOU HELP
- You never write any of the essay: no sentences for it, no paragraphs, no
  wording of their argument. They write every word.
- Build on their own words. Quote a phrase they used when you point at it.
  A note that could be said about any essay is wasted.
- Plain English, short sentences, British spelling.
- Never praise or react: no "great", "interesting", "strong", "thanks", no
  exclamation marks. Never summarise what they said back to them.`;

function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** Lines starting `KEY:` in a reply, in order, each with its value run on to the next blank or key line. */
function keyed(reply: string, keys: readonly string[]): { key: string; value: string }[] {
  const out: { key: string; value: string }[] = [];
  const pattern = new RegExp(`^[-*\\s]*(${keys.join('|')})\\s*:\\s*(.*)$`, 'i');
  let current: { key: string; value: string } | null = null;
  for (const raw of reply.split('\n')) {
    const line = raw.replace(/\*\*/g, '').trim();
    const match = pattern.exec(line);
    if (match) {
      current = { key: match[1]!.toUpperCase(), value: match[2]!.trim() };
      out.push(current);
    } else if (current && line) {
      current.value = `${current.value} ${line}`.trim();
    } else {
      current = null;
    }
  }
  return out.map((o) => ({ key: o.key, value: oneLine(o.value) }));
}

const PRAISE =
  /\b(great|interesting|fascinating|love|wonderful|excellent|nice|strong|compelling|intriguing|good (?:question|point|answer|start)|thanks?|thank you)\b/i;

/** A note Dash may show: short, not praise, and not a paragraph of prose. */
function usableNote(value: string, max = 320): string | null {
  const note = value.replace(/^["“]+|["”]+$/g, '').trim();
  if (note.length < 12 || note.length > max) return null;
  if (PRAISE.test(note) || note.includes('!')) return null;
  return note;
}

/** A question Dash may ask: one sentence ending in a question mark. */
export function usableQuestion(value: string, max = 300): string | null {
  const ask = usableNote(value, max);
  if (!ask || !ask.endsWith('?')) return null;
  if ((ask.match(/\?/g) ?? []).length > 1) return null;
  return ask;
}

function describeBrief(brief: EssayBrief): string {
  const lines: string[] = [];
  for (const field of BRIEF_FIELDS) {
    const answer = brief[field].trim();
    lines.push(`${PLAIN_ASKS[field]}`, answer ? `  ${answer}` : '  (not answered)');
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Discover: Dash's read of the brief
// ---------------------------------------------------------------------------

export const READBACK_SYSTEM = `You are Dash, reading someone's answers before they write a short essay of
their own. Your job is to show them where their thinking is still loose, so
the essay they write is sharper.

${RULES}

You are told their answers to five questions, and sometimes their replies to
notes you gave before. Write:

- Up to ${READBACK_NOTES_MAX} notes. Each names one specific problem in their answers and ends
  with a question that would help them fix it. Good problems to look for: a
  question so broad nobody could disagree with any answer; an answer that is
  really several claims; a reader who does not match the question; a gap
  between what made them think it and what they claim; nothing that would
  change their mind. Skip anything they have already settled in a reply.
- Up to ${SHARPER_MAX} sharper versions of their question: narrower, answerable in under
  2,000 words, and phrased so a reader could disagree with the answer. Keep
  their subject and their words where you can.

Reply in exactly this form and nothing else:
NOTE: <one or two sentences, ending with a question>
SHARPER: <a sharper question>`;

export function readbackPrompt(
  brief: EssayBrief,
  replies: readonly { body: string; reply: string }[],
): string {
  const lines = ['Their answers, in their words:', describeBrief(brief)];
  const answered = replies.filter((r) => r.reply.trim());
  if (answered.length > 0) {
    lines.push('', 'Notes you gave before and their replies:');
    for (const r of answered) lines.push(`- You: ${r.body}`, `  They: ${r.reply.trim()}`);
  }
  return lines.join('\n');
}

export function readReadback(reply: string): { notes: string[]; sharper: string[] } {
  const notes: string[] = [];
  const sharper: string[] = [];
  for (const { key, value } of keyed(reply, ['NOTE', 'SHARPER'])) {
    if (key === 'NOTE') {
      const note = usableNote(value);
      if (note && note.includes('?') && notes.length < READBACK_NOTES_MAX) notes.push(note);
    } else {
      const ask = usableQuestion(value, 220);
      if (ask && sharper.length < SHARPER_MAX && !sharper.includes(ask)) sharper.push(ask);
    }
  }
  return { notes, sharper };
}

// ---------------------------------------------------------------------------
// Plan: points found in what they already wrote
// ---------------------------------------------------------------------------

export const FIND_POINTS_MAX = 8;

export const FIND_POINTS_SYSTEM = `You are Dash, helping someone plan a short essay of their own. They have
already written a fair amount while answering questions about it. Your job
is to find, in what they wrote, the passages that could each be one point of
the essay.

${RULES}

Copy each passage exactly as they wrote it, character for character, typos
and all: a phrase or a sentence, at most about forty words. Do not reword,
join or tidy anything; a passage that is not word for word in their writing
is thrown away. Pick passages that make a claim a reader could question, not
background. Leave out anything already in their list of points.

Reply with up to ${FIND_POINTS_MAX} lines in exactly this form and nothing else:
QUOTE: <their exact words>`;

export function findPointsPrompt(
  brief: EssayBrief,
  sources: readonly { label: string; text: string }[],
  points: readonly PlanPoint[],
): string {
  const lines = [
    `The essay's question: ${brief.question.trim() || '(not written yet)'}`,
    '',
    'What they wrote:',
  ];
  for (const s of sources) lines.push(`[${s.label}]`, s.text.trim(), '');
  const have = points.filter((p) => p.text.trim());
  lines.push(
    'Their points so far:',
    ...(have.length ? have.map((p) => `- ${p.text.trim()}`) : ['(none)']),
  );
  return lines.join('\n');
}

/** The passages that are word for word in what they wrote, and not already a point. */
export function readFoundPoints(
  reply: string,
  sources: readonly { text: string }[],
  points: readonly PlanPoint[],
): string[] {
  const have = points.map((p) => oneLine(p.text).toLowerCase());
  const out: string[] = [];
  for (const { value } of keyed(reply, ['QUOTE'])) {
    const quote = value.replace(/^["“]+|["”]+$/g, '').trim();
    if (quote.length > 400 || !isOwnWords(quote, sources)) continue;
    const key = oneLine(quote).toLowerCase();
    if (have.includes(key) || out.some((o) => oneLine(o).toLowerCase() === key)) continue;
    out.push(quote);
    if (out.length === FIND_POINTS_MAX) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Plan: Dash's notes on the plan
// ---------------------------------------------------------------------------

export const REVIEW_SYSTEM = `You are Dash, the first reader of someone's plan for a short essay of their
own. You are given their question, the one-sentence answer they are arguing,
their reader, and their points in order, with what they worked out under
each. Your job is to find the biggest problems with the plan before they
write it.

${RULES}

Look for, in this order: a point that does not serve their answer; a step
the reader would need that is missing; the strongest objection nothing in
the plan answers; an order that makes the reader wait for the point; a point
that is really two. Name at most ${REVIEW_MAX} problems, the most important first, and
none at all if the plan holds up.

Each note names the problem, points at the point by its number, and ends with
a question that helps them decide what to do. Do not tell them what to write.

Reply in exactly this form and nothing else (or the single word: None):
NOTE: <one or two sentences, ending with a question>`;

function describePoints(points: readonly PlanPoint[]): string {
  const lines: string[] = [];
  points.forEach((point, i) => {
    lines.push(
      `${i + 1}. [${ROLE_LABELS[point.role]}] ${point.text.trim() || '(empty part: ' + point.guide + ')'}`,
    );
    for (const note of point.notes) lines.push(`   Q: ${note.ask}`, `   A: ${note.answer}`);
  });
  return lines.length ? lines.join('\n') : '(no points yet)';
}

export function reviewPrompt(brief: EssayBrief, plan: EssayPlan): string {
  return [
    `Question: ${brief.question.trim() || '(not written)'}`,
    `Their answer, in a sentence: ${plan.thesis.trim() || brief.claim.trim() || '(not written)'}`,
    `Reader: ${brief.reader.trim() || 'a friend who knows nothing about it'}`,
    `What would change their mind: ${brief.change.trim() || '(not written)'}`,
    '',
    'Their points, in order:',
    describePoints(plan.points),
  ].join('\n');
}

export function readReview(reply: string): string[] {
  const out: string[] = [];
  for (const { value } of keyed(reply, ['NOTE'])) {
    const note = usableNote(value, 400);
    if (note && note.includes('?') && out.length < REVIEW_MAX) out.push(note);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Structure: shapes the essay could take
// ---------------------------------------------------------------------------

export const SHAPES_MAX = 3;
const PARTS_MAX = 8;

export const SHAPES_SYSTEM = `You are Dash, helping someone choose the structure of a short essay of their
own, 200 to 2,000 words. You are given their question, their answer, their
reader and their points, numbered.

${RULES}

Offer ${SHAPES_MAX - 1} or ${SHAPES_MAX} different shapes the essay could take, each suited to this
question and this reader. For each shape, list its parts in order. A part has
a role (opening, point, objection or closing), one short line saying what
that part does for the reader (not what it argues: never write their
argument for them), and the numbers of their points that belong in it. Every
point of theirs should go somewhere in each shape. A part none of their
points fits is fine: it shows them what is missing.

Reply in exactly this form and nothing else:
## <the shape's name, three to six words>
WHY: <one sentence on why this shape suits their question and reader>
PART: <role> | <what this part does> | <point numbers, comma separated, or blank>`;

export function shapesPrompt(brief: EssayBrief, plan: EssayPlan): string {
  return [
    `Question: ${brief.question.trim() || '(not written)'}`,
    `Their answer: ${plan.thesis.trim() || brief.claim.trim() || '(not written)'}`,
    `Reader: ${brief.reader.trim() || 'a friend who knows nothing about it'}`,
    '',
    'Their points:',
    ...plan.points.filter((p) => p.text.trim()).map((p, i) => `${i + 1}. ${p.text.trim()}`),
  ].join('\n');
}

function readRole(value: string): Role | null {
  const word = value.trim().toLowerCase();
  if ((ROLES as readonly string[]).includes(word)) return word as Role;
  if (/^(intro|introduction|hook|open)/.test(word)) return 'opening';
  if (/^(conclusion|close|ending|end)/.test(word)) return 'closing';
  if (/^(counter|objection|rebuttal|doubt)/.test(word)) return 'objection';
  if (/^(point|reason|body|argument|section)/.test(word)) return 'point';
  return null;
}

/**
 * The shapes from the reply. Point numbers become the ids of the points they
 * name (numbered over the points that have words), and a number that names
 * no point is dropped. A shape with fewer than two parts is dropped.
 */
export function readShapes(reply: string, plan: EssayPlan): Shape[] {
  const numbered = plan.points.filter((p) => p.text.trim());
  const shapes: Shape[] = [];
  let current: Shape | null = null;
  for (const raw of reply.split('\n')) {
    const line = raw.replace(/\*\*/g, '').trim();
    const heading = /^#{1,3}\s+(.+)$/.exec(line);
    if (heading) {
      current = { name: oneLine(heading[1]!).slice(0, 80), why: '', parts: [] };
      shapes.push(current);
      continue;
    }
    if (!current) continue;
    const why = /^WHY\s*:\s*(.+)$/i.exec(line);
    if (why) {
      current.why = usableNote(why[1]!, 300) ?? '';
      continue;
    }
    const part = /^[-*\s]*PART\s*:\s*(.+)$/i.exec(line);
    if (!part || current.parts.length >= PARTS_MAX) continue;
    const [roleText = '', guide = '', nums = ''] = part[1]!.split('|');
    const role = readRole(roleText);
    const said = oneLine(guide);
    if (!role || said.length < 4 || said.length > 200 || PRAISE.test(said)) continue;
    const points = [...nums.matchAll(/\d+/g)]
      .map((m) => numbered[Number(m[0]) - 1]?.id)
      .filter((id): id is string => Boolean(id));
    current.parts.push({ role, guide: said, points: [...new Set(points)] });
  }
  return shapes.filter((s) => s.parts.length >= 2).slice(0, SHAPES_MAX);
}

/**
 * Shapes to offer when Dash cannot be asked: three classic structures for a
 * short argued essay, with every point in the middle.
 */
export function plainShapes(plan: EssayPlan): Shape[] {
  const ids = plan.points.filter((p) => p.text.trim()).map((p) => p.id);
  return [
    {
      name: 'Claim, reasons, objection',
      why: 'The plainest shape for arguing one answer: say it, give the reasons, then meet the best case against it.',
      parts: [
        { role: 'opening', guide: 'Pose the question and give your answer up front.', points: [] },
        { role: 'point', guide: 'Each reason, strongest first.', points: ids },
        {
          role: 'objection',
          guide: 'The best case against your answer, and your reply to it.',
          points: [],
        },
        { role: 'closing', guide: 'What follows for the reader if you are right.', points: [] },
      ],
    },
    {
      name: 'Problem, lens, what it shows',
      why: 'Suits applying an idea from one field to another: name the problem, bring in the lens, show what it reveals.',
      parts: [
        { role: 'opening', guide: 'The problem the reader has, in their terms.', points: [] },
        {
          role: 'point',
          guide: 'The idea you are borrowing, and what it reveals when applied here.',
          points: ids,
        },
        { role: 'objection', guide: 'Where the lens does not fit.', points: [] },
        { role: 'closing', guide: 'What the reader should do differently.', points: [] },
      ],
    },
    {
      name: 'Story, then the idea',
      why: 'Opens on a case the reader can picture, then draws the idea out of it.',
      parts: [
        { role: 'opening', guide: 'One concrete case or moment.', points: [] },
        { role: 'point', guide: 'What the case shows, a point at a time.', points: ids },
        { role: 'closing', guide: 'Back to the case, seen differently now.', points: [] },
      ],
    },
  ];
}

// ---------------------------------------------------------------------------
// Develop: one question at a time about a point
// ---------------------------------------------------------------------------

export const DIG_SYSTEM = `You are Dash, helping someone work out one point of a short essay they are
writing themselves, by asking them one question at a time. Their answers
become their notes for writing that part.

${RULES}

You are told their question and answer for the essay, the point, what that
part of the essay does, the answers they have given about it so far, and the
kind of question to ask next. Ask that one question.

- One question, one sentence, under 35 words, ending with a question mark.
- Make it specific to their point: pick up a word they used or a gap in what
  they have said. If an earlier answer was vague, ask them to pin it down.
- Never suggest the answer inside the question.

Reply with the question alone, with no quotation marks and nothing before or
after it.`;

export function digPrompt(input: {
  brief: EssayBrief;
  plan: EssayPlan;
  point: PlanPoint;
  kind: DigKind;
}): string {
  const { brief, plan, point } = input;
  const index = plan.points.findIndex((p) => p.id === point.id);
  const before = index > 0 ? plan.points[index - 1] : null;
  const lines = [
    `The essay's question: ${brief.question.trim() || '(not written)'}`,
    `Their answer: ${plan.thesis.trim() || brief.claim.trim() || '(not written)'}`,
    `Reader: ${brief.reader.trim() || 'a friend who knows nothing about it'}`,
    '',
    `The point (${ROLE_LABELS[point.role].toLowerCase()}): ${point.text.trim()}`,
  ];
  if (point.guide.trim()) lines.push(`What this part does: ${point.guide.trim()}`);
  if (before?.text.trim()) lines.push(`The point before it: ${before.text.trim()}`);
  if (point.notes.length > 0) {
    lines.push('', 'What they have said about it so far:');
    for (const note of point.notes) lines.push(`- Q: ${note.ask}`, `  A: ${note.answer}`);
  }
  lines.push('', `Next, ask about ${DIG_ASKS[input.kind]}.`);
  return lines.join('\n');
}

/** The question asked when Dash's wording is not to hand. */
export const PLAIN_DIG: Record<DigKind, string> = {
  why: 'Why is this true? What is the reason behind it?',
  example: 'What is one concrete example of this, ideally one you have seen yourself?',
  evidence: 'What would show a sceptical reader that this holds?',
  doubt: 'What would someone who disagrees say about this, and what would you say back?',
  reader: 'Why should your reader care about this point?',
  link: 'How does this point lead to your answer?',
};
