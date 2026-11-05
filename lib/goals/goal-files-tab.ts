import { areaRunView, type GoalRun } from '@/lib/goals/shaping';
import type { GoalFileRow } from '@/lib/goals/goal-files';

/**
 * A goal's Work & files tab (plan #2778.7): its files in four views, what the
 * goal is still waiting for, where a file you add belongs, and every piece of
 * work Dash took on for the goal.
 *
 * Pure, so the wording and the matching are tested without a database. The
 * reads are in lib/goals/goal-files-tab-store.ts.
 */

export type FileView = 'all' | 'dash' | 'yours' | 'waiting';

export const FILE_VIEWS: readonly { value: FileView; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'dash', label: 'Dash wrote' },
  { value: 'yours', label: 'Yours' },
  { value: 'waiting', label: 'Waiting for' },
];

/** A document a step on the goal is waiting for (goals.document_kinds, migration 0093). */
export type WaitingKind = {
  kindId: string;
  name: string;
  /** How to tell a document is of this kind, for matching a file you add. */
  recognise: string;
  /** The step that waits for it: its own, or the information step its form is on. */
  stepId: string;
  stepTitle: string;
};

/** One row under Waiting for: a kind no file on the goal has filled yet. */
export type WaitingRow = WaitingKind;

/**
 * The kinds still waiting: those no live file link on the goal names. A kind
 * is filled as soon as one file of its kind is linked, from an upload or from
 * Gmail.
 */
export function waitingRows(
  kinds: readonly WaitingKind[],
  filledKindIds: ReadonlySet<string>,
): WaitingRow[] {
  const seen = new Set<string>();
  return kinds.filter((kind) => {
    if (filledKindIds.has(kind.kindId) || seen.has(kind.kindId)) return false;
    seen.add(kind.kindId);
    return true;
  });
}

/** The files a view lists: pinned first, then the newest. */
export function filesInView<T extends Pick<GoalFileRow, 'byDash' | 'updatedAt' | 'pinned'>>(
  rows: readonly T[],
  view: Exclude<FileView, 'waiting'>,
): T[] {
  return rows
    .filter((row) => view === 'all' || (view === 'dash' ? row.byDash : !row.byDash))
    .sort((a, b) => {
      if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
      return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
    });
}

/** How many each view holds, for beside its label. */
export function viewCounts(
  rows: readonly Pick<GoalFileRow, 'byDash'>[],
  waiting: number,
): Record<FileView, number> {
  const dash = rows.filter((row) => row.byDash).length;
  return { all: rows.length, dash, yours: rows.length - dash, waiting };
}

/** What a view says when it holds nothing. */
export function emptyViewLine(view: FileView): string {
  switch (view) {
    case 'all':
      return 'What Dash writes for this goal, and what you add, lands here.';
    case 'dash':
      return 'What Dash writes for a step on this goal lands here.';
    case 'yours':
      return 'Statements, letters and screenshots you add land here.';
    case 'waiting':
      return 'A document a step asks for shows here until it arrives.';
  }
}

/** "PDF", "Image", "Note": what a file is, for the mark beside it. */
export function fileTypeLabel(contentType: string | null | undefined): string {
  if (!contentType) return 'Note';
  if (contentType === 'application/pdf') return 'PDF';
  if (contentType.startsWith('image/')) return 'Img';
  if (contentType.includes('wordprocessingml')) return 'Word';
  if (contentType === 'text/csv') return 'CSV';
  return 'Text';
}

/** "240 KB", "1.2 MB". */
export function sizeWords(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// --- Where a file you add belongs ------------------------------------------

const STOP = new Set([
  'the', 'and', 'for', 'from', 'with', 'your', 'you', 'that', 'this', 'into', 'all', 'each',
  'pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'docx', 'txt', 'csv', 'html', 'htm',
  'scan', 'img', 'image', 'file', 'document', 'doc', 'copy', 'final', 'save', 'get',
]);

/** The words of a name worth matching on: three letters or more, no filler, no extension. */
export function matchWords(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/\.[a-z0-9]{2,5}$/, '')
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3 && !STOP.has(word) && !/^\d+$/.test(word));
  return new Set(words);
}

function overlap(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  let n = 0;
  for (const word of a) if (b.has(word)) n += 1;
  return n;
}

export type UploadPlace = {
  /** The step the file goes on, or null for the goal itself. */
  stepId: string | null;
  /** The kind it fills under Waiting for, or null. */
  kindId: string | null;
};

/**
 * Where Dash puts a file you add to the goal (plan #2778.7). A kind still
 * waiting whose name shares words with the file's name wins, counted twice
 * for its name and once for how it is recognised, and the file goes on that
 * kind's step and fills it. Failing that, the open step whose title shares
 * the most words with the name, at least two. Failing that, the goal. Pressing
 * Add on a row under Waiting for names the kind, and that settles it.
 */
export function uploadPlace(
  name: string,
  waiting: readonly WaitingKind[],
  openSteps: readonly { id: string; title: string }[],
  chosenKindId?: string | null,
): UploadPlace {
  if (chosenKindId) {
    const chosen = waiting.find((kind) => kind.kindId === chosenKindId);
    if (chosen) return { stepId: chosen.stepId, kindId: chosen.kindId };
  }
  const words = matchWords(name);
  let best: { kind: WaitingKind; score: number } | null = null;
  for (const kind of waiting) {
    const named = overlap(words, matchWords(kind.name));
    if (named === 0) continue;
    const score = named * 2 + overlap(words, matchWords(kind.recognise));
    if (!best || score > best.score) best = { kind, score };
  }
  if (best) return { stepId: best.kind.stepId, kindId: best.kind.kindId };

  let step: { id: string; score: number } | null = null;
  for (const candidate of openSteps) {
    const score = overlap(words, matchWords(candidate.title));
    if (score >= 2 && (!step || score > step.score)) step = { id: candidate.id, score };
  }
  return { stepId: step?.id ?? null, kindId: null };
}

/** The title a file you add is listed under: its name without the extension or the path's id. */
export function uploadTitle(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  const title = base.replace(/\.[A-Za-z0-9]{2,5}$/, '').replace(/[_]+/g, ' ').trim();
  return (title || base || 'Untitled').slice(0, 200);
}

// --- Dash's work -----------------------------------------------------------

/** A run on the goal or one of its steps, as the store reads it. */
export type WorkRun = GoalRun & {
  job: string;
  itemId: string | null;
  question: string | null;
  origin: 'ask_dash' | 'chat' | 'goal_page' | null;
};

export type WorkEntry = {
  runId: string;
  /** The question asked, or what the run was for. */
  title: string;
  state: 'running' | 'done' | 'failed';
  /** "From Ask Dash", "From a chat", "On the step “Apply for IBR”", "On the goal". */
  startedFrom: string;
  /** Where it has got to, what it found, or why it stopped. */
  result: string | null;
  /** The file it wrote, when one is on the goal. */
  file: { fileId: string; title: string } | null;
  /** ISO instant it started, for the date beside it. */
  at: string;
};

const JOB_TITLES: Record<string, string> = {
  goal: 'Mapped the goal',
  reshape: 'Re-shaped the plan',
  daily: 'Morning check on the goal',
  weekly: 'Weekly look for suggestions',
  raise: 'Answered a flag',
};

/**
 * Every piece of work Dash took on for the goal, newest first (plan #2778.7):
 * the question or what it was for, where it started, what came of it and
 * the file it wrote. A step's run names the step and takes the newest file
 * written for that step since the run began; a question's run takes a file
 * written for the goal itself in that time.
 */
export function workEntries(
  runs: readonly WorkRun[],
  goalId: string,
  stepTitles: ReadonlyMap<string, string>,
  files: readonly Pick<GoalFileRow, 'fileId' | 'title' | 'byDash' | 'updatedAt' | 'stepId'>[],
  now: number,
): WorkEntry[] {
  return [...runs]
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .map((run) => {
      const view = areaRunView(run, now);
      const state: WorkEntry['state'] = view.running ? 'running' : view.error ? 'failed' : 'done';
      const onStep = run.itemId && run.itemId !== goalId ? run.itemId : null;
      const stepTitle = onStep ? (stepTitles.get(onStep) ?? null) : null;
      const startedFrom =
        run.origin === 'ask_dash'
          ? 'From Ask Dash'
          : run.origin === 'chat'
            ? 'From a chat'
            : run.origin === 'goal_page'
              ? 'Asked on the goal'
              : stepTitle
                ? `On the step “${stepTitle}”`
                : 'On the goal';
      const title = run.question ?? stepTitle ?? JOB_TITLES[run.job] ?? 'Work on the goal';
      const since = Date.parse(run.createdAt);
      const file =
        files
          .filter(
            (f) =>
              f.byDash &&
              (onStep ? f.stepId === onStep : run.question ? !f.stepId : false) &&
              Date.parse(f.updatedAt) >= since,
          )
          .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0] ?? null;
      return {
        runId: run.id,
        title,
        state,
        startedFrom,
        result: view.running ?? view.error ?? view.summary,
        file: file ? { fileId: file.fileId, title: file.title } : null,
        at: run.createdAt,
      };
    });
}

/** "6 pieces · 1 going", for beside the heading. */
export function workCount(entries: readonly Pick<WorkEntry, 'state'>[]): string | null {
  if (entries.length === 0) return null;
  const going = entries.filter((entry) => entry.state === 'running').length;
  const pieces = entries.length === 1 ? '1 piece' : `${entries.length} pieces`;
  return going > 0 ? `${pieces} · ${going} going` : pieces;
}
