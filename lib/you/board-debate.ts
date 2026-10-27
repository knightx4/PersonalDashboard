import type { YouSupabaseClient } from '@/lib/you/db/schema-name';
import { SEATS, type BoardReceipt } from '@/lib/you/board';
import type { MadeItem } from '@/lib/you/board-make';
import { optionsOf, type BoardOption, type QuestionStatus, QUESTION_STATUSES } from '@/lib/you/board-questions';

/**
 * One meeting's debate as its page reads it (plan #2561.5): the questions the
 * meeting took up, every turn spoken on them (you.board_turns, plan #2561.1)
 * and the advisors who spoke, so the page can draw each question's score grid,
 * its rounds and each advisor's thinking.
 *
 * The board skill writes the turns through scripts/sql.ts
 * (.claude/skills/board/SKILL.md), so rows are read defensively: a score that
 * is not a number from 1 to 10 is dropped and the rest of the turn kept.
 */

export type AdvisorKind = 'seat' | 'guest';

export type DebateAdvisor = {
  id: string;
  key: string;
  name: string;
  kind: AdvisorKind;
  /** The one question the advisor owns. */
  question: string | null;
  focus: string | null;
  /** What a guest's brain was built from. */
  sources: BoardReceipt[];
};

export type TurnKind = 'opening' | 'reply' | 'vote';
export type Round = 1 | 2 | 3;
export type Scores = Record<string, number>;

export type DebateTurn = {
  id: string;
  questionId: string | null;
  round: Round;
  advisorId: string;
  addressedTo: string | null;
  kind: TurnKind;
  text: string;
  scores: Scores | null;
  receipts: BoardReceipt[];
  position: number;
};

export type BoardVerdict = {
  recommended: string | null;
  conditions: string[];
  dissent: { advisor: string; text: string }[];
  wouldChange: string[];
  /** What the board took as given where a fact was missing (plan #2561.11). */
  assumptions: string[];
  /** Each advisor's final score per option, by advisor key. */
  scores: { advisor: string; scores: Scores }[];
};

/** The person's decision on a question: an option, or putting it off or turning it down. */
export type QuestionDecision = {
  kind: 'option' | 'defer' | 'reject';
  /** The option letter, for `option`. */
  option: string | null;
  note: string | null;
  decidedAt: string | null;
};

/** The decision a question row holds, from its status and decision columns. */
export function decisionFromRow(row: Record<string, unknown>): QuestionDecision | null {
  const note = text(row.decision_note) || null;
  if (row.status === 'decided') {
    const option = text(row.decided_option);
    return option
      ? { kind: 'option', option, note, decidedAt: typeof row.decided_at === 'string' ? row.decided_at : null }
      : null;
  }
  if (row.status === 'deferred') return { kind: 'defer', option: null, note, decidedAt: null };
  if (row.status === 'dismissed') return { kind: 'reject', option: null, note, decidedAt: null };
  return null;
}

export type DebateQuestion = {
  id: string;
  question: string;
  options: BoardOption[];
  status: QuestionStatus;
  verdict: BoardVerdict | null;
  /** What the person did with the verdict (plan #2561.6); null while they have not. */
  decision: QuestionDecision | null;
  /** The todos and goal steps Make it happen wrote from the decision (plan #2561.9), as they are now; the page fills it in. */
  made: MadeItem[];
  /** Its turns, in the order they were spoken. */
  turns: DebateTurn[];
};

export type MeetingDebate = {
  questions: DebateQuestion[];
  advisors: DebateAdvisor[];
};

export const NO_DEBATE: MeetingDebate = { questions: [], advisors: [] };

// ---------------------------------------------------------------------------
// Reading rows a session wrote.
// ---------------------------------------------------------------------------

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

function receiptsOf(value: unknown): BoardReceipt[] {
  return list(value).flatMap((entry) => {
    const row = record(entry);
    const label = text(row?.label);
    const link = text(row?.link);
    return label && link ? [{ label, link }] : [];
  });
}

/** { "A": 7, "B": 4 }, keeping only single letters scored 1 to 10; null when none are left. */
export function scoresOf(value: unknown): Scores | null {
  const row = record(value);
  if (!row) return null;
  const out: Scores = {};
  for (const [letter, score] of Object.entries(row)) {
    const n = typeof score === 'number' ? score : typeof score === 'string' ? Number(score) : NaN;
    if (/^[A-Z]$/.test(letter) && Number.isFinite(n) && n >= 1 && n <= 10) out[letter] = n;
  }
  return Object.keys(out).length ? out : null;
}

export function verdictOf(value: unknown): BoardVerdict | null {
  const row = record(value);
  if (!row) return null;
  const texts = (v: unknown) => list(v).map(text).filter(Boolean);
  return {
    recommended: /^[A-Z]$/.test(text(row.recommended)) ? text(row.recommended) : null,
    conditions: texts(row.conditions),
    dissent: list(row.dissent).flatMap((entry) => {
      const d = record(entry);
      const advisor = text(d?.advisor);
      const said = text(d?.text);
      return advisor && said ? [{ advisor, text: said }] : [];
    }),
    wouldChange: texts(row.would_change),
    assumptions: texts(row.assumptions),
    scores: list(row.scores).flatMap((entry) => {
      const s = record(entry);
      const advisor = text(s?.advisor);
      const scores = scoresOf(s?.scores);
      return advisor && scores ? [{ advisor, scores }] : [];
    }),
  };
}

export function turnOf(row: Record<string, unknown>): DebateTurn | null {
  const round = Number(row.round);
  const kind = text(row.kind);
  const said = text(row.text);
  if (typeof row.id !== 'string' || typeof row.advisor_id !== 'string') return null;
  if (round !== 1 && round !== 2 && round !== 3) return null;
  if (kind !== 'opening' && kind !== 'reply' && kind !== 'vote') return null;
  if (!said) return null;
  return {
    id: row.id,
    questionId: typeof row.question_id === 'string' ? row.question_id : null,
    round,
    advisorId: row.advisor_id,
    addressedTo: typeof row.addressed_to === 'string' ? row.addressed_to : null,
    kind,
    text: said,
    scores: scoresOf(row.scores),
    receipts: receiptsOf(row.receipts),
    position: typeof row.position === 'number' ? row.position : 0,
  };
}

export function advisorOf(row: Record<string, unknown>): DebateAdvisor | null {
  const key = text(row.key);
  const name = text(row.name);
  if (typeof row.id !== 'string' || !key || !name) return null;
  return {
    id: row.id,
    key,
    name,
    kind: row.kind === 'seat' ? 'seat' : 'guest',
    question: text(row.question) || null,
    focus: text(row.focus) || null,
    sources: receiptsOf(row.sources),
  };
}

/**
 * The debate from its rows: the questions in the order the minutes' agenda
 * gives them (then any the agenda leaves out, oldest first), each with its
 * turns in the order spoken, and the advisors who spoke or were spoken to.
 */
export function debateFrom(
  questionRows: readonly Record<string, unknown>[],
  turnRows: readonly Record<string, unknown>[],
  advisorRows: readonly Record<string, unknown>[],
  agenda: readonly string[] = [],
): MeetingDebate {
  const turns = turnRows
    .map(turnOf)
    .filter((t): t is DebateTurn => t !== null)
    .sort((a, b) => a.position - b.position);
  const questions = questionRows.flatMap((row): DebateQuestion[] => {
    const question = text(row.question);
    const status = QUESTION_STATUSES.find((s) => s === row.status);
    if (typeof row.id !== 'string' || !question || !status) return [];
    return [
      {
        id: row.id,
        question,
        options: optionsOf(row.options),
        status,
        verdict: verdictOf(row.verdict),
        decision: decisionFromRow(row),
        made: [],
        turns: turns.filter((t) => t.questionId === row.id),
      },
    ];
  });
  const created = new Map(questionRows.map((r) => [r.id, String(r.created_at ?? '')]));
  const rank = (id: string) => {
    const at = agenda.indexOf(id);
    return at === -1 ? agenda.length : at;
  };
  questions.sort(
    (a, b) =>
      rank(a.id) - rank(b.id) || (created.get(a.id) ?? '').localeCompare(created.get(b.id) ?? ''),
  );
  const spoke = new Set(turns.flatMap((t) => (t.addressedTo ? [t.advisorId, t.addressedTo] : [t.advisorId])));
  const verdictKeys = new Set(questions.flatMap((q) => q.verdict?.scores.map((s) => s.advisor) ?? []));
  const advisors = advisorRows
    .map(advisorOf)
    .filter((a): a is DebateAdvisor => a !== null && (spoke.has(a.id) || verdictKeys.has(a.key)));
  return { questions, advisors: sortByBoard(advisors) };
}

const SEAT_RANK = new Map<string, number>(SEATS.map((seat, i) => [seat, i]));

/** The five seats in the board's order, then the guests by name. */
export function sortByBoard<T extends { kind: AdvisorKind; key: string; name: string }>(
  advisors: readonly T[],
): T[] {
  const rank = (a: T) => (a.kind === 'seat' ? (SEAT_RANK.get(a.key) ?? 50) : 99);
  return [...advisors].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// What the page draws.
// ---------------------------------------------------------------------------

export type ScoreCell = { final: number | null; first: number | null };
export type ScoreRow = { advisor: DebateAdvisor; cells: Record<string, ScoreCell>; backs: string | null };

/**
 * The grid of who scored what: one row per advisor who scored the question,
 * the final score per option (their last turn with scores, or the verdict's
 * when no turn carries one) beside the round 1 score. `backs` is the option
 * they scored highest at the end, or null on a tie at the top.
 */
export function scoreGrid(question: DebateQuestion, advisors: readonly DebateAdvisor[]): ScoreRow[] {
  const rows: ScoreRow[] = [];
  for (const advisor of advisors) {
    const theirs = question.turns.filter((t) => t.advisorId === advisor.id && t.scores);
    const first = theirs.find((t) => t.round === 1)?.scores ?? null;
    const last =
      theirs.at(-1)?.scores ??
      question.verdict?.scores.find((s) => s.advisor === advisor.key)?.scores ??
      null;
    if (!first && !last) continue;
    const cells: Record<string, ScoreCell> = {};
    for (const { letter } of question.options) {
      cells[letter] = { final: last?.[letter] ?? null, first: first?.[letter] ?? null };
    }
    rows.push({ advisor, cells, backs: topOf(last) });
  }
  return rows;
}

function topOf(scores: Scores | null): string | null {
  if (!scores) return null;
  const entries = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  if (!entries.length || (entries[1] && entries[1][1] === entries[0][1])) return null;
  return entries[0][0];
}

/** The turns of one round, in the order spoken. */
export function turnsInRound(question: DebateQuestion, round: Round): DebateTurn[] {
  return question.turns.filter((t) => t.round === round);
}

/**
 * Round 2 as conversations: the replies grouped by the two advisors in them,
 * each group in the order spoken, the groups in the order each began. A reply
 * to the room is a group of its own speaker.
 */
export function exchanges(question: DebateQuestion): { between: string[]; turns: DebateTurn[] }[] {
  const groups = new Map<string, { between: string[]; turns: DebateTurn[] }>();
  for (const turn of turnsInRound(question, 2)) {
    const between = turn.addressedTo
      ? [turn.advisorId, turn.addressedTo].sort()
      : [turn.advisorId];
    const key = between.join(':');
    const group = groups.get(key) ?? { between: [turn.advisorId, ...(turn.addressedTo ? [turn.addressedTo] : [])], turns: [] };
    group.turns.push(turn);
    groups.set(key, group);
  }
  return [...groups.values()];
}

/** A turn written as a brief for the option nobody backed (the skill's unanimous rule). */
export const BRIEF_OPENING = /^Arguing for [A-Z], which nobody backed:\s*/;

export type AdvisorQuestion = {
  question: DebateQuestion;
  turns: DebateTurn[];
  /** Their scores after each round they scored in, in order. */
  moves: { round: Round; scores: Scores }[];
};

/**
 * One advisor's thinking in the meeting: per question they spoke on, every
 * turn they wrote and how their scores moved round by round.
 */
export function advisorThinking(debate: MeetingDebate, advisorId: string): AdvisorQuestion[] {
  return debate.questions.flatMap((question) => {
    const turns = question.turns.filter((t) => t.advisorId === advisorId);
    if (!turns.length) return [];
    const moves: { round: Round; scores: Scores }[] = [];
    for (const turn of turns) {
      if (!turn.scores) continue;
      const last = moves.at(-1);
      if (last && last.round === turn.round) last.scores = turn.scores;
      else moves.push({ round: turn.round, scores: turn.scores });
    }
    return [{ question, turns, moves }];
  });
}

// ---------------------------------------------------------------------------
// Loading.
// ---------------------------------------------------------------------------

/**
 * The debate held in one meeting. Empty for a meeting written in the old
 * minutes form, which took up no question, so its page keeps the old view.
 */
export async function loadMeetingDebate(
  client: YouSupabaseClient,
  userId: string,
  meetingId: string,
  agenda: readonly string[] = [],
): Promise<MeetingDebate> {
  const [questions, turns, advisors] = await Promise.all([
    client
      .from('board_questions')
      .select('id, question, options, status, verdict, decided_option, decision_note, decided_at, created_at')
      .eq('user_id', userId)
      .eq('meeting_id', meetingId),
    client
      .from('board_turns')
      .select('id, question_id, round, advisor_id, addressed_to, kind, text, scores, receipts, position')
      .eq('user_id', userId)
      .eq('meeting_id', meetingId)
      .order('position'),
    client
      .from('board_advisors')
      .select('id, key, name, kind, question, focus, sources:brain->sources')
      .eq('user_id', userId),
  ]);
  if (questions.error) throw new Error(`Reading the meeting's questions failed: ${questions.error.message}`);
  if (turns.error) throw new Error(`Reading the meeting's debate failed: ${turns.error.message}`);
  if (advisors.error) throw new Error(`Reading the board's advisors failed: ${advisors.error.message}`);
  return debateFrom(
    (questions.data ?? []) as Record<string, unknown>[],
    (turns.data ?? []) as Record<string, unknown>[],
    (advisors.data ?? []) as unknown as Record<string, unknown>[],
    agenda,
  );
}
