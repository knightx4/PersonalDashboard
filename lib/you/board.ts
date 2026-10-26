import { isTimeZone, whenWeekday, zoneParts } from '@/lib/core/when';
import type { YouSupabaseClient } from '@/lib/you/db/schema-name';

/**
 * The board's meetings and the person's marks on them (you.board_meetings and
 * you.board_marks, migrations-you/0020, plan #2540.1), read for the Board tab
 * in You (plan #2540.3).
 *
 * A board session writes the minutes as jsonb through scripts/sql.ts
 * (.claude/skills/board/SKILL.md), so they are read defensively, as the
 * Insights tab reads its cards: an entry of the wrong shape is dropped and the
 * rest kept. Every call names the person as well as relying on row level
 * security, so the same functions serve a service-role client.
 */

export const SEATS = ['hiring_manager', 'mentor', 'skeptic', 'cfo', 'dreamer'] as const;
export type Seat = (typeof SEATS)[number];

/** How a seat is named in a sentence: "the CFO". */
export const SEAT_NAMES: Record<Seat, string> = {
  hiring_manager: 'the hiring manager',
  mentor: 'the mentor',
  skeptic: 'the skeptic',
  cfo: 'the CFO',
  dreamer: 'the dreamer',
};

/** How a seat is named on a button or over its paragraph: "Hiring manager". */
export const SEAT_LABELS: Record<Seat, string> = {
  hiring_manager: 'Hiring manager',
  mentor: 'Mentor',
  skeptic: 'Skeptic',
  cfo: 'CFO',
  dreamer: 'Dreamer',
};

export const VOTE_VALUES = [...SEATS, 'neither'] as const;
export type VoteValue = (typeof VOTE_VALUES)[number];

export const MARK_KINDS = ['vote', 'answer', 'resolution'] as const;
export type MarkKind = (typeof MARK_KINDS)[number];

export const MEETING_STATUSES = ['queued', 'running', 'ready', 'failed'] as const;
export type MeetingStatus = (typeof MEETING_STATUSES)[number];

export const GRADES = ['hit', 'miss', 'cant_tell', 'pending'] as const;
export type Grade = (typeof GRADES)[number];

/** The shape the table holds a mark's item in (board_marks.item). */
export const ITEM_KEY = /^[a-z0-9_]{1,40}$/;

/** The most an answer and a note hold (board_marks.value and .note). */
export const ANSWER_MAX = 4000;
export const NOTE_MAX = 2000;

export type BoardReceipt = { label: string; link: string };

export type BoardPosition = {
  seat: Seat;
  stance: string | null;
  text: string;
  receipts: BoardReceipt[];
};

export type BoardDisagreement = {
  /** Null when the minutes gave none the table could hold, so it cannot be voted on. */
  key: string | null;
  point: string;
  positions: BoardPosition[];
  note: string | null;
};

export type BoardDream = { text: string; thread: string | null; receipts: BoardReceipt[] };

export type BoardResolution = {
  key: string | null;
  what: string;
  day: string | null;
  seats: Seat[];
};

export type BoardPrediction = { seat: Seat; text: string };

export type BoardGraded = { seat: Seat; text: string; grade: Grade; fact: string | null };

export type BoardScore = { seat: Seat; hits: number; misses: number };

export type BoardRebuttal = { to: Seat | null; stance: string | null; text: string };

export type BoardMemo = {
  seat: Seat;
  memo: string;
  resolution: string | null;
  prediction: string | null;
  rebuttal: BoardRebuttal | null;
};

export type BoardMinutes = {
  since: string | null;
  disagreements: BoardDisagreement[];
  dream: BoardDream | null;
  question: string | null;
  resolutions: BoardResolution[];
  resolutionsNote: string | null;
  predictions: BoardPrediction[];
  predictionsNote: string | null;
  graded: BoardGraded[];
  gradedNote: string | null;
  scorecard: BoardScore[];
  memos: BoardMemo[];
  memosNote: string | null;
};

export type BoardMeeting = {
  id: string;
  kind: 'weekly' | 'called';
  decision: string | null;
  status: MeetingStatus;
  heldOn: string | null;
  error: string | null;
  runUrl: string | null;
  requestedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

export type BoardMark = {
  kind: MarkKind;
  item: string;
  value: string;
  note: string | null;
  todoId: string | null;
  markedAt: string;
};

/** One meeting as its list row needs it: the meeting, and how far through it they are. */
export type BoardMeetingRow = BoardMeeting & {
  counts: {
    disagreements: number;
    voted: number;
    resolutions: number;
    done: number;
    answered: boolean;
  };
};

// ---------------------------------------------------------------------------
// Reading jsonb a session wrote.
// ---------------------------------------------------------------------------

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const textOrNull = (value: unknown): string | null => text(value) || null;
const oneOf = <T extends string>(words: readonly T[], value: unknown): T | null =>
  typeof value === 'string' && (words as readonly string[]).includes(value) ? (value as T) : null;
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const keyOf = (value: unknown): string | null =>
  typeof value === 'string' && ITEM_KEY.test(value) ? value : null;
const count = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;

function receiptsOf(value: unknown): BoardReceipt[] {
  return list(value).flatMap((entry) => {
    const row = record(entry);
    const label = text(row?.label);
    const link = text(row?.link);
    return label && link ? [{ label, link }] : [];
  });
}

/** "can't tell", as a chair may write it, reads as cant_tell. */
function gradeOf(value: unknown): Grade | null {
  if (typeof value !== 'string') return null;
  const word = value.trim().toLowerCase().replace(/['’]/g, '').replace(/\s+/g, '_');
  return oneOf(GRADES, word);
}

/** The minutes as the tab draws them; anything that is not an object reads as empty minutes. */
export function parseMinutes(value: unknown): BoardMinutes {
  const row = record(value) ?? {};
  const dreamRow = record(row.dream);
  const dreamText = text(dreamRow?.text);
  return {
    since: textOrNull(row.since),
    disagreements: list(row.disagreements).flatMap((entry) => {
      const d = record(entry);
      const point = text(d?.point);
      if (!d || !point) return [];
      const positions = list(d.positions).flatMap((p) => {
        const position = record(p);
        const seat = oneOf(SEATS, position?.seat);
        const said = text(position?.text);
        return position && seat && said
          ? [
              {
                seat,
                stance: textOrNull(position.stance),
                text: said,
                receipts: receiptsOf(position.receipts),
              },
            ]
          : [];
      });
      return [{ key: keyOf(d.key), point, positions, note: textOrNull(d.note) }];
    }),
    dream: dreamText
      ? {
          text: dreamText,
          thread: textOrNull(dreamRow?.thread),
          receipts: receiptsOf(dreamRow?.receipts),
        }
      : null,
    question: textOrNull(row.question),
    resolutions: list(row.resolutions).flatMap((entry) => {
      const r = record(entry);
      const what = text(r?.what);
      if (!r || !what) return [];
      const day = text(r.day);
      return [
        {
          key: keyOf(r.key),
          what,
          day: /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null,
          seats: list(r.seats).flatMap((s) => {
            const seat = oneOf(SEATS, s);
            return seat ? [seat] : [];
          }),
        },
      ];
    }),
    resolutionsNote: textOrNull(row.resolutions_note),
    predictions: list(row.predictions).flatMap((entry) => {
      const p = record(entry);
      const seat = oneOf(SEATS, p?.seat);
      const said = text(p?.text);
      return seat && said ? [{ seat, text: said }] : [];
    }),
    predictionsNote: textOrNull(row.predictions_note),
    graded: gradedOf(row.graded),
    gradedNote: textOrNull(row.graded_note),
    scorecard: list(row.scorecard).flatMap((entry) => {
      const s = record(entry);
      const seat = oneOf(SEATS, s?.seat);
      return s && seat ? [{ seat, hits: count(s.hits), misses: count(s.misses) }] : [];
    }),
    memos: list(row.memos).flatMap((entry) => {
      const m = record(entry);
      const seat = oneOf(SEATS, m?.seat);
      const memo = text(m?.memo);
      if (!m || !seat || !memo) return [];
      const r = record(m.rebuttal);
      const rebuttalText = text(r?.text);
      return [
        {
          seat,
          memo,
          resolution: textOrNull(m.resolution),
          prediction: textOrNull(m.prediction),
          rebuttal: rebuttalText
            ? { to: oneOf(SEATS, r?.to), stance: textOrNull(r?.stance), text: rebuttalText }
            : null,
        },
      ];
    }),
    memosNote: textOrNull(row.memos_note),
  };
}

function gradedOf(value: unknown): BoardGraded[] {
  return list(value).flatMap((entry) => {
    const g = record(entry);
    const seat = oneOf(SEATS, g?.seat);
    const said = text(g?.text);
    const grade = gradeOf(g?.grade);
    return g && seat && said && grade
      ? [{ seat, text: said, grade, fact: textOrNull(g.fact) }]
      : [];
  });
}

function meetingOf(row: Record<string, unknown>): BoardMeeting {
  return {
    id: String(row.id),
    kind: row.kind === 'called' ? 'called' : 'weekly',
    decision: textOrNull(row.decision),
    status: oneOf(MEETING_STATUSES, row.status) ?? 'failed',
    heldOn: textOrNull(row.held_on),
    error: textOrNull(row.error),
    runUrl: textOrNull(row.run_url),
    requestedAt: String(row.requested_at ?? ''),
    startedAt: textOrNull(row.started_at),
    finishedAt: textOrNull(row.finished_at),
  };
}

function markOf(row: Record<string, unknown>): BoardMark | null {
  const kind = oneOf(MARK_KINDS, row.kind);
  const item = typeof row.item === 'string' ? row.item : '';
  const value = typeof row.value === 'string' ? row.value : '';
  if (!kind || !item || !value) return null;
  return {
    kind,
    item,
    value,
    note: textOrNull(row.note),
    todoId: textOrNull(row.todo_id),
    markedAt: String(row.marked_at ?? ''),
  };
}

const MEETING_COLUMNS =
  'id, kind, decision, status, held_on, error, run_url, requested_at, started_at, finished_at';
const MARK_COLUMNS = 'kind, item, value, note, todo_id, marked_at';

// ---------------------------------------------------------------------------
// What the tab reads.
// ---------------------------------------------------------------------------

/**
 * Every meeting, newest first: one still to be held (no held_on) before the
 * rest, then by the day it was held. Only the parts of the minutes the rows
 * count are read, so the list does not carry every memo.
 */
export async function listBoardMeetings(
  client: YouSupabaseClient,
  userId: string,
): Promise<BoardMeetingRow[]> {
  const [meetings, marks] = await Promise.all([
    client
      .from('board_meetings')
      .select(
        `${MEETING_COLUMNS}, disagreements:minutes->disagreements, resolutions:minutes->resolutions, question:minutes->question`,
      )
      .eq('user_id', userId)
      .order('held_on', { ascending: false, nullsFirst: true })
      .order('requested_at', { ascending: false }),
    client.from('board_marks').select(`meeting_id, ${MARK_COLUMNS}`).eq('user_id', userId),
  ]);
  if (meetings.error)
    throw new Error(`Reading your board meetings failed: ${meetings.error.message}`);
  if (marks.error)
    throw new Error(`Reading your marks on the board's minutes failed: ${marks.error.message}`);
  const byMeeting = new Map<string, BoardMark[]>();
  for (const row of (marks.data ?? []) as Record<string, unknown>[]) {
    const mark = markOf(row);
    if (!mark) continue;
    const id = String(row.meeting_id);
    byMeeting.set(id, [...(byMeeting.get(id) ?? []), mark]);
  }
  return ((meetings.data ?? []) as Record<string, unknown>[]).map((row) => {
    const meeting = meetingOf(row);
    const minutes = parseMinutes({
      disagreements: row.disagreements,
      resolutions: row.resolutions,
      question: row.question,
    });
    return { ...meeting, counts: progress(minutes, byMeeting.get(meeting.id) ?? []) };
  });
}

/** How far through a meeting's minutes the person is. */
export function progress(
  minutes: BoardMinutes,
  marks: readonly BoardMark[],
): BoardMeetingRow['counts'] {
  const has = (kind: MarkKind, item: string | null, value?: string) =>
    item !== null &&
    marks.some(
      (m) => m.kind === kind && m.item === item && (value === undefined || m.value === value),
    );
  const votable = minutes.disagreements.filter((d) => d.key);
  const resolutions = minutes.resolutions.filter((r) => r.key);
  return {
    disagreements: votable.length,
    voted: votable.filter((d) => has('vote', d.key)).length,
    resolutions: resolutions.length,
    done: resolutions.filter((r) => has('resolution', r.key, 'done')).length,
    answered: has('answer', 'question'),
  };
}

/** One meeting with its minutes and the person's marks on it, or null when it is not theirs. */
export async function loadBoardMeeting(
  client: YouSupabaseClient,
  userId: string,
  meetingId: string,
): Promise<{ meeting: BoardMeeting; minutes: BoardMinutes; marks: BoardMark[] } | null> {
  const [meeting, marks] = await Promise.all([
    client
      .from('board_meetings')
      .select(`${MEETING_COLUMNS}, minutes`)
      .eq('user_id', userId)
      .eq('id', meetingId)
      .maybeSingle(),
    client
      .from('board_marks')
      .select(MARK_COLUMNS)
      .eq('user_id', userId)
      .eq('meeting_id', meetingId),
  ]);
  if (meeting.error) throw new Error(`Reading the board meeting failed: ${meeting.error.message}`);
  if (marks.error)
    throw new Error(`Reading your marks on the board's minutes failed: ${marks.error.message}`);
  if (!meeting.data) return null;
  const row = meeting.data as Record<string, unknown>;
  return {
    meeting: meetingOf(row),
    minutes: parseMinutes(row.minutes),
    marks: ((marks.data ?? []) as Record<string, unknown>[]).flatMap((m) => markOf(m) ?? []),
  };
}

/**
 * Each seat's hits and misses across every meeting, counted from the graded
 * predictions in all the minutes. Counted rather than taken from the newest
 * meeting's scorecard, so a chair who added wrong, or a meeting held before
 * the last one was graded, does not move the tally. Every seat is listed, in
 * the board's order, at zero when it has not been graded yet.
 */
export function scorecardFrom(gradedLists: readonly (readonly BoardGraded[])[]): BoardScore[] {
  const tally = new Map<Seat, BoardScore>(
    SEATS.map((seat) => [seat, { seat, hits: 0, misses: 0 }]),
  );
  for (const graded of gradedLists) {
    for (const entry of graded) {
      const score = tally.get(entry.seat)!;
      if (entry.grade === 'hit') score.hits += 1;
      if (entry.grade === 'miss') score.misses += 1;
    }
  }
  return SEATS.map((seat) => tally.get(seat)!);
}

/** The scorecard across every meeting of theirs (scorecardFrom). */
export async function boardScorecard(
  client: YouSupabaseClient,
  userId: string,
): Promise<BoardScore[]> {
  const { data, error } = await client
    .from('board_meetings')
    .select('graded:minutes->graded')
    .eq('user_id', userId)
    .eq('status', 'ready');
  if (error) throw new Error(`Reading the board's scorecard failed: ${error.message}`);
  return scorecardFrom(
    ((data ?? []) as Record<string, unknown>[]).map((row) => gradedOf(row.graded)),
  );
}

// ---------------------------------------------------------------------------
// The person's marks.
// ---------------------------------------------------------------------------

/**
 * Puts one mark on a meeting, replacing the one already on that item and
 * moving marked_at. A resolution's todo link is left as it is unless one is
 * given, so ticking a resolution keeps the todo made from it.
 */
export async function saveBoardMark(
  client: YouSupabaseClient,
  userId: string,
  meetingId: string,
  mark: { kind: MarkKind; item: string; value: string; note?: string | null; todoId?: string },
): Promise<BoardMark> {
  if (!ITEM_KEY.test(mark.item)) throw new Error('That is not an item in these minutes.');
  const value = mark.value.trim();
  if (!value) throw new Error('A mark needs a value.');
  if (value.length > ANSWER_MAX) throw new Error('An answer holds at most 4,000 characters.');
  const note = mark.note === undefined ? undefined : textOrNull(mark.note);
  if (note && note.length > NOTE_MAX) throw new Error('A note holds at most 2,000 characters.');
  const { data, error } = await client
    .from('board_marks')
    .upsert(
      {
        user_id: userId,
        meeting_id: meetingId,
        kind: mark.kind,
        item: mark.item,
        value,
        ...(note !== undefined ? { note } : {}),
        ...(mark.todoId ? { todo_id: mark.todoId } : {}),
        marked_at: new Date().toISOString(),
      },
      { onConflict: 'meeting_id,kind,item' },
    )
    .select(MARK_COLUMNS)
    .single();
  const saved = data ? markOf(data as Record<string, unknown>) : null;
  if (error || !saved) throw new Error(`Saving your mark failed: ${error?.message ?? 'no row'}`);
  return saved;
}

/** Takes a mark off, such as an answer cleared to nothing. */
export async function clearBoardMark(
  client: YouSupabaseClient,
  userId: string,
  meetingId: string,
  kind: MarkKind,
  item: string,
): Promise<void> {
  const { error } = await client
    .from('board_marks')
    .delete()
    .eq('user_id', userId)
    .eq('meeting_id', meetingId)
    .eq('kind', kind)
    .eq('item', item);
  if (error) throw new Error(`Clearing your mark failed: ${error.message}`);
}

// ---------------------------------------------------------------------------
// What the tab says.
// ---------------------------------------------------------------------------

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A date as the minutes' title writes it: 26 Oct 2026. */
export function heldOnLabel(day: string): string {
  const [year, month, date] = day.split('-').map(Number);
  if (!year || !month || !date) return day;
  return `${date} ${MONTHS[month - 1]} ${year}`;
}

/** What a meeting is called: the minutes' title, or the decision a called meeting was about. */
export function meetingTitle(meeting: Pick<BoardMeeting, 'kind' | 'decision' | 'heldOn'>): string {
  if (meeting.kind === 'called' && meeting.decision) return meeting.decision;
  return meeting.heldOn ? `Board meeting ${heldOnLabel(meeting.heldOn)}` : 'Board meeting';
}

/** A meeting's link text with the links taken out, for a todo's title: "[note](/x)" reads "note". */
export function plainText(markdown: string): string {
  return markdown
    .replace(/\[([^\]\n]+)\]\([^)\s]+\)/g, '$1')
    .replace(/[*_`]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A meeting still queued or running this long after it was asked for has
 * stopped, and the tab shows it failed. Three hours, as the insights runs.
 */
export const MEETING_STALE_AFTER_MS = 3 * 60 * 60 * 1000;
export const STALE_MEETING_ERROR = 'The meeting stopped without finishing.';

export type MeetingState =
  | { kind: 'running'; since: string }
  | { kind: 'failed'; error: string; asked: string }
  | { kind: 'ready' };

/** What the tab shows about a meeting's state; one open past the stale mark reads as failed. */
export function meetingState(meeting: BoardMeeting, now: number = Date.now()): MeetingState {
  if (meeting.status === 'queued' || meeting.status === 'running') {
    const asked = Date.parse(meeting.requestedAt);
    if (Number.isFinite(asked) && now - asked > MEETING_STALE_AFTER_MS) {
      return { kind: 'failed', error: STALE_MEETING_ERROR, asked: meeting.requestedAt };
    }
    return { kind: 'running', since: meeting.startedAt ?? meeting.requestedAt };
  }
  if (meeting.status === 'failed') {
    return {
      kind: 'failed',
      error: meeting.error ?? 'The meeting did not finish.',
      asked: meeting.requestedAt,
    };
  }
  return { kind: 'ready' };
}

/** When the weekly board sits: Sundays at 6:41pm in the person's zone (the board task). */
export const MEETING_WEEKDAY = 0;
export const MEETING_TIME = { hour: 18, minute: 41 };

/**
 * The day of the next weekly meeting in their zone, as a date (2026-11-01):
 * today when it is Sunday before 6:41pm, else the coming Sunday.
 */
export function nextMeetingDay(timezone: string, now: number = Date.now()): string {
  const parts = zoneParts(now, isTimeZone(timezone) ? timezone : 'UTC');
  const minutes = parts.hour * 60 + parts.minute;
  const before = minutes < MEETING_TIME.hour * 60 + MEETING_TIME.minute;
  const ahead =
    parts.weekday === MEETING_WEEKDAY && before
      ? 0
      : (MEETING_WEEKDAY - parts.weekday + 7) % 7 || 7;
  const today = Date.UTC(parts.year, parts.month - 1, parts.day);
  return new Date(today + ahead * 86_400_000).toISOString().slice(0, 10);
}

/** "Sunday 1 Nov", for the empty tab. */
export function meetingDayLabel(day: string): string {
  return `${whenWeekday(day, { timeZone: 'UTC' })} ${heldOnLabel(day).replace(/ \d{4}$/, '')}`;
}
