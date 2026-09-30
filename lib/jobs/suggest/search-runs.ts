import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';
import type { SuggestionKind } from './cadence';

/**
 * The log of search runs (job_search.search_runs, 0040), so the page can say
 * what a search is doing and how the last one ended.
 *
 * A run writes its stage as it goes. The platform stops a request at five
 * minutes without warning, so a run cut off there never writes that it
 * failed; a row still running after STOPPED_AFTER_MINUTES is read as stopped.
 */

export const SEARCH_STAGES = ['boards', 'searching', 'saving', 'postings', 'scoring', 'done', 'failed'] as const;
export type SearchStage = (typeof SEARCH_STAGES)[number];

/** What each stage is called while it runs. */
export const STAGE_LABELS: Record<SearchStage, string> = {
  boards: 'Reading the job boards of companies you follow',
  searching: 'Searching the web',
  saving: 'Saving what it found',
  postings: 'Reading each posting',
  scoring: 'Scoring the new roles',
  done: 'Done',
  failed: 'Failed',
};

/** Past the route's five minutes, with a minute's slack. */
export const STOPPED_AFTER_MINUTES = 6;

export type SearchRunRow = {
  id: string;
  kind: SuggestionKind;
  trigger: 'button' | 'daily';
  stage: SearchStage;
  started_at: string;
  finished_at: string | null;
  written: number;
  boards_read: number;
  candidates: number;
  error: string | null;
};

/** A run as the page shows it. */
export type SearchRunView = {
  state: 'running' | 'done' | 'failed' | 'stopped';
  stage: SearchStage;
  trigger: 'button' | 'daily';
  startedAt: string;
  finishedAt: string | null;
  written: number;
  boardsRead: number;
  candidates: number;
  error: string | null;
};

export function viewRun(row: SearchRunRow, now: Date = new Date()): SearchRunView {
  const running = row.stage !== 'done' && row.stage !== 'failed';
  const age = now.getTime() - new Date(row.started_at).getTime();
  const state = running ? (age > STOPPED_AFTER_MINUTES * 60_000 ? 'stopped' : 'running') : row.stage === 'done' ? 'done' : 'failed';
  return {
    state,
    stage: row.stage,
    trigger: row.trigger,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    written: row.written,
    boardsRead: row.boards_read,
    candidates: row.candidates,
    error: row.error,
  };
}

const COLUMNS = 'id, kind, trigger, stage, started_at, finished_at, written, boards_read, candidates, error';

/** The newest run of a kind, or null when there is none or the read failed. */
export async function loadLatestRun(
  supabase: AppSupabaseClient,
  userId: string,
  kind: SuggestionKind,
  now: Date = new Date(),
): Promise<SearchRunView | null> {
  const { data, error } = await supabase
    .from('search_runs')
    .select(COLUMNS)
    .eq('user_id', userId)
    .eq('kind', kind)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return viewRun(data as SearchRunRow, now);
}

/** Counts a stage can report alongside itself. */
export type StageCounts = Partial<{ written: number; boards_read: number; candidates: number }>;

/**
 * What the search reports to as it goes. Each kind's row is made on its
 * first stage, unless the caller made it already (the button makes the
 * roles row before answering, so the page shows the search at once).
 * A failed write is logged and never stops the search.
 */
export type SearchProgress = {
  stage: (kind: SuggestionKind, stage: SearchStage, counts?: StageCounts) => Promise<void>;
  finish: (kind: SuggestionKind, outcome: { written: number; error: string | null }) => Promise<void>;
};

export function recordRuns(
  supabase: AppSupabaseClient,
  userId: string,
  trigger: 'button' | 'daily',
  existing: Partial<Record<SuggestionKind, string>> = {},
): SearchProgress {
  const ids: Partial<Record<SuggestionKind, string>> = { ...existing };
  const write = async (kind: SuggestionKind, patch: Record<string, unknown>) => {
    const id = ids[kind];
    if (id) {
      const { error } = await supabase.from('search_runs').update(patch).eq('id', id).eq('user_id', userId);
      if (error) console.error('[jobs suggestions] run log', error.message);
      return;
    }
    const { data, error } = await supabase
      .from('search_runs')
      .insert({ user_id: userId, kind, trigger, ...patch })
      .select('id')
      .single();
    if (error || !data) console.error('[jobs suggestions] run log', error?.message);
    else ids[kind] = data.id as string;
  };
  return {
    stage: (kind, stage, counts = {}) => write(kind, { stage, ...counts }),
    finish: (kind, outcome) =>
      write(kind, {
        stage: outcome.error ? 'failed' : 'done',
        finished_at: new Date().toISOString(),
        written: outcome.written,
        error: outcome.error ? outcome.error.slice(0, 1000) : null,
      }),
  };
}

/** Start a run's row before the work begins, for the button. Null when the write failed. */
export async function startRun(
  supabase: AppSupabaseClient,
  userId: string,
  kind: SuggestionKind,
  trigger: 'button' | 'daily',
): Promise<string | null> {
  const { data, error } = await supabase
    .from('search_runs')
    .insert({ user_id: userId, kind, trigger, stage: kind === 'apply' ? 'boards' : 'searching' })
    .select('id')
    .single();
  if (error || !data) return null;
  return data.id as string;
}

/** "just now", "4 minutes ago", "3 hours ago", "2 days ago". */
export function agoText(iso: string, now: Date = new Date()): string {
  const minutes = Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? 'day' : 'days'} ago`;
}

/** The line the Recommended roles section shows about the latest run. */
export type RunLine = { running: boolean; tone: 'plain' | 'warn'; text: string };

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export function describeRun(run: SearchRunView | null, now: Date = new Date()): RunLine | null {
  if (!run) return null;
  const who = run.trigger === 'daily' ? 'The daily search' : 'The search';
  const boards =
    run.boardsRead > 0
      ? ` Read ${plural(run.boardsRead, 'job board', 'job boards')}, ${plural(run.candidates, 'posting', 'postings')} worth a look.`
      : '';
  switch (run.state) {
    case 'running':
      return {
        running: true,
        tone: 'plain',
        text: `${STAGE_LABELS[run.stage]}… Started ${agoText(run.startedAt, now)}.${run.stage === 'boards' ? '' : boards} This takes a few minutes.`,
      };
    case 'done':
      return {
        running: false,
        tone: 'plain',
        text:
          run.written > 0
            ? `${who} ${agoText(run.finishedAt ?? run.startedAt, now)} found ${plural(run.written, 'new role', 'new roles')}.${boards}`
            : `${who} ${agoText(run.finishedAt ?? run.startedAt, now)} found nothing new.${boards}`,
      };
    case 'failed':
      return {
        running: false,
        tone: 'warn',
        text: `${who} ${agoText(run.finishedAt ?? run.startedAt, now)} failed: ${run.error ?? 'no reason was given'}`,
      };
    case 'stopped':
      return {
        running: false,
        tone: 'warn',
        text: `${who} started ${agoText(run.startedAt, now)} stopped while ${STAGE_LABELS[run.stage].toLowerCase()} and did not finish. Nothing it found was saved. Press Search now to try again.`,
      };
  }
}
