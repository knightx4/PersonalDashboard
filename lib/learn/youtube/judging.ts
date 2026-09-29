import 'server-only';

import type Anthropic from '@anthropic-ai/sdk';
import { sumByModel, type SpendReport } from '@/lib/core/spend/pricing';
import { decideWithJev } from '@/lib/jev/decide';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { loadGraph, loadSubjects } from '@/lib/learn/graph/load';
import { rootingFor } from '@/lib/learn/graph/rooting';
import { chaptersFromDescription } from '@/lib/learn/providers/youtube';
import {
  chapterWindows,
  judgeVideo,
  nextStep,
  screenVideos,
  SCREEN_BATCH,
  transcriptWindows,
  type FiledVideo,
  type LearnerProfile,
  type Verdict,
  type TranscriptStatus,
  type SettledVerdict,
  type VideoToJudge,
  type VideoToScreen,
} from './judge-video';
import {
  JUDGE_QUESTION,
  judgeState,
  jevLine,
  overrideFor,
  SCREEN_QUESTION,
  screenState,
  VIDEO_JUDGE_ON_JEV,
} from './judge-jev-question';
import { loadTranscript, MAX_ATTEMPTS, queueTranscripts } from './transcripts';

/**
 * Judging the videos on everybody's list, from the library run (plan #1066).
 *
 * First the screen: every video not yet read goes to judge-video.ts in
 * batches, and a clear skip is written there and then, from the title alone.
 * The rest are marked screened, and their transcripts are asked for with
 * requested_by 'list', so the run's credit allowance (budget.ts) fetches them
 * over the next runs. Then the second pass takes every screened video whose
 * transcript has arrived, or that will be judged from its chapters, and
 * settles it.
 *
 * A verdict you set (verdict_by 'you', #1068) is never read or written here:
 * every read skips a row with a verdict, and every write is guarded on
 * verdict_by as well, for a move made while the run was working. Your moves
 * are read, though, as examples in the profile both passes are sent. The
 * judge's own answer goes in judge_verdict beside the verdict, so a move keeps
 * what it disagreed with.
 *
 * For an account that opted in to Jev (plan #1170), both passes ask Jev one
 * question per video first (judge-jev-question.ts). The screen skips what Jev
 * is at least 0.8 sure is a clear skip and lets everything else through,
 * because the screen's own rule is to look when in doubt; Haiku screens only
 * what Jev could not answer. The second pass settles a skip Jev is 0.8 sure
 * of with no Haiku call, and for a watch or card Jev is that sure of asks
 * Haiku only to name the windows; below 0.8, Haiku judges it as before. A
 * video on a channel or topic you filed against the judge is never settled
 * by Jev: Haiku judges it, reading your filings as examples.
 *
 * Runs with the service client, so every read and write names the person.
 */

const CONCURRENCY = 4;
const BATCH = 200;
/** Tracks and ideas in the prompt before it stops being read. */
const MAX_TRACKS = 12;
const MAX_GOALS = 20;
const MAX_IDEAS = 60;
const NAMES_PER_THEME = 4;
/** Videos you filed yourself, sent as examples (#1068). */
const MAX_FILED = 15;

type ItemRow = {
  title: string;
  author: string | null;
  description: string | null;
  duration_seconds: number | null;
  provider: { name: string } | { name: string }[] | null;
};

type ListRow = {
  user_id: string;
  video_id: string;
  summary: string | null;
  key_points: string[] | null;
  item: ItemRow | null;
};

type ListVideo = VideoToScreen & { userId: string; keyPoints: string[] };

export type JudgePassResult = {
  /** Clear skips written by the first pass, with no transcript asked for. */
  skipped: number;
  /** Let through by the first pass, to be judged from their transcript or chapters. */
  passed: number;
  /** Transcripts asked for this run. */
  queued: number;
  /** Verdicts settled by the second pass. */
  judged: number;
  failed: number;
  stopped: string | null;
};

const SELECT =
  'user_id, video_id, summary, key_points, item:catalogue_items!watch_list_item_id_fkey(title, author, description, duration_seconds, provider:catalogue_providers!catalogue_items_provider_id_fkey(name))';

function toVideo(row: ListRow): ListVideo | null {
  if (!row.item) return null;
  const provider = Array.isArray(row.item.provider) ? row.item.provider[0] : row.item.provider;
  return {
    userId: row.user_id,
    videoId: row.video_id,
    title: row.item.title,
    // Under youtube-list the channel is the author; under a followed channel it is the provider.
    channel: row.item.author ?? provider?.name ?? null,
    durationSeconds: row.item.duration_seconds,
    description: row.item.description,
    summary: row.summary,
    keyPoints: row.key_points ?? [],
  };
}

async function listVideos(learn: LearnSupabaseClient, screened: boolean): Promise<ListVideo[]> {
  let query = learn.from('watch_list').select(SELECT).is('left_playlist_at', null).is('verdict', null);
  query = screened ? query.not('screened_at', 'is', null) : query.is('screened_at', null);
  const { data, error } = await query.order('added_at', { ascending: false });
  if (error) throw new Error(`Reading the list to judge failed: ${error.message}`);
  return ((data ?? []) as unknown as ListRow[]).map(toVideo).filter((video): video is ListVideo => video !== null);
}

/** What Learn knows about one person: tracks and where they are, open Goals, Learn now ideas. */
export async function loadLearnerProfile(learn: LearnSupabaseClient, userId: string): Promise<LearnerProfile> {
  const subjects = (await loadSubjects(learn, userId)).slice(0, MAX_TRACKS);
  const tracks = await Promise.all(
    subjects.map(async (subject) => {
      const rooting = rootingFor(await loadGraph(learn, subject.id, userId), null);
      return {
        name: subject.name,
        note: subject.note,
        frontier: rooting.frontier,
        settled: rooting.settled.length + rooting.settledOmitted,
      };
    }),
  );

  const goalRows = await learn
    .schema('goals')
    .from('items')
    .select('title, detail')
    .eq('user_id', userId)
    .eq('level', 'goal')
    .eq('status', 'open')
    .is('archived_at', null)
    .is('dismissed_at', null)
    .order('position')
    .limit(MAX_GOALS);
  if (goalRows.error) throw new Error(`Reading your goals failed: ${goalRows.error.message}`);

  const ideaRows = await learn
    .from('concepts')
    .select('name, subject_id')
    .eq('user_id', userId)
    .eq('origin', 'feed')
    .order('created_at', { ascending: false })
    .limit(MAX_IDEAS);
  if (ideaRows.error) throw new Error(`Reading your ideas failed: ${ideaRows.error.message}`);
  const ideas = (ideaRows.data ?? []) as { name: string; subject_id: string }[];
  const themeIds = [...new Set(ideas.map((idea) => idea.subject_id))];
  const themeNames = new Map<string, string>();
  if (themeIds.length > 0) {
    const themes = await learn.from('subjects').select('id, name').eq('user_id', userId).in('id', themeIds);
    if (themes.error) throw new Error(`Reading your themes failed: ${themes.error.message}`);
    for (const theme of (themes.data ?? []) as { id: string; name: string }[]) themeNames.set(theme.id, theme.name);
  }
  const byTheme = new Map<string, string[]>();
  for (const idea of ideas) {
    const theme = themeNames.get(idea.subject_id);
    if (!theme) continue;
    const names = byTheme.get(theme) ?? [];
    if (names.length < NAMES_PER_THEME) names.push(idea.name);
    byTheme.set(theme, names);
  }

  const filedRows = await learn
    .from('watch_list')
    .select('verdict, judge_verdict, item:catalogue_items!watch_list_item_id_fkey(title, author)')
    .eq('user_id', userId)
    .eq('verdict_by', 'you')
    .order('judged_at', { ascending: false, nullsFirst: false })
    .limit(MAX_FILED);
  if (filedRows.error) throw new Error(`Reading the videos you filed failed: ${filedRows.error.message}`);
  type FiledRow = {
    verdict: Verdict;
    judge_verdict: Verdict | null;
    item: { title: string; author: string | null } | { title: string; author: string | null }[] | null;
  };
  const filed = ((filedRows.data ?? []) as unknown as FiledRow[]).flatMap((row): FiledVideo[] => {
    const item = Array.isArray(row.item) ? row.item[0] : row.item;
    return item ? [{ title: item.title, channel: item.author, judge: row.judge_verdict, you: row.verdict }] : [];
  });

  return {
    filed,
    tracks,
    goals: ((goalRows.data ?? []) as { title: string; detail: string | null }[]).map((goal) => ({ title: goal.title, detail: goal.detail })),
    ideas: [...byTheme].map(([theme, names]) => ({ theme, names })),
  };
}

async function transcriptStatuses(learn: LearnSupabaseClient, videoIds: string[]): Promise<Map<string, TranscriptStatus>> {
  const out = new Map<string, TranscriptStatus>();
  for (let from = 0; from < videoIds.length; from += BATCH) {
    const { data, error } = await learn
      .from('video_transcripts')
      .select('video_id, state, attempts')
      .in('video_id', videoIds.slice(from, from + BATCH));
    if (error) throw new Error(`Reading transcript states failed: ${error.message}`);
    for (const row of (data ?? []) as { video_id: string; state: 'queued' | 'fetched' | 'none' | 'failed'; attempts: number }[]) {
      out.set(row.video_id, { state: row.state, attempts: row.attempts });
    }
  }
  return out;
}

/** Write to one row unless you have set its verdict yourself. */
async function writeRow(learn: LearnSupabaseClient, video: ListVideo, update: Record<string, unknown>): Promise<void> {
  const { error } = await learn
    .from('watch_list')
    .update(update)
    .eq('user_id', video.userId)
    .eq('video_id', video.videoId)
    .or('verdict_by.is.null,verdict_by.neq.you');
  if (error) throw new Error(`Storing the verdict failed: ${error.message}`);
}

type ScreenRow = { videoId: string; decision: 'skip' | 'look'; why: string | null };

/**
 * One screening batch put to Jev, a question per video. `settled` is what
 * Jev decided: a skip it is 0.8 sure of, and a look at any confidence, since
 * the screen looks when in doubt. `rest` goes to Haiku: the videos Jev
 * could not answer and the ones your filings override. Jev's spend is
 * reported once per model for the batch.
 */
async function screenWithJev(
  batch: ListVideo[],
  profile: LearnerProfile,
  enabled: boolean,
  onSpend: (report: SpendReport) => void,
  jev: { apiKey?: string | null; fetch?: typeof fetch } = {},
): Promise<{ settled: ScreenRow[]; rest: ListVideo[] }> {
  if (!enabled) return { settled: [], rest: batch };
  type Route = ScreenRow | { by: 'haiku' };
  const reports: SpendReport[] = [];
  const routes = await Promise.all(
    batch.map(async (video): Promise<Route> => {
      if (overrideFor(video, profile.filed)) return { by: 'haiku' };
      const look: ScreenRow = { videoId: video.videoId, decision: 'look', why: null };
      const decided = await decideWithJev<typeof SCREEN_QUESTION, Route>({
        state: screenState(profile, video),
        question: SCREEN_QUESTION,
        read: (answer) =>
          answer.choice === 'skip' ? { videoId: video.videoId, decision: 'skip', why: jevLine('screen', answer) } : look,
        fallback: async (reason) => (reason.why === 'low-confidence' ? look : { by: 'haiku' }),
        onSpend: (report) => reports.push(report),
        apiKey: jev.apiKey,
        fetch: jev.fetch,
      });
      return decided.value;
    }),
  );
  for (const report of sumByModel(reports)) onSpend(report);
  const settled: ScreenRow[] = [];
  const rest: ListVideo[] = [];
  routes.forEach((route, index) => ('by' in route ? rest.push(batch[index]) : settled.push(route)));
  return { settled, rest };
}

/** Screen and judge until the list or the time runs out. */
export async function judgeWatchLists(
  learn: LearnSupabaseClient,
  options: {
    anthropicApiKey: string;
    deadline: number;
    client?: Anthropic;
    /** Called once per call made, with the person the videos belong to and which pass it was. */
    onSpend?: (userId: string, pass: 'screen' | 'judge', report: SpendReport) => void;
    now?: () => Date;
    /** Stands in for loadLearnerProfile, for tests. */
    profileFor?: (userId: string) => Promise<LearnerProfile>;
    /** Whether this person's videos may go to Jev (jevEnabledFor). Without it, none do. */
    jevEnabled?: (userId: string) => Promise<boolean>;
    jevApiKey?: string | null;
    jevFetch?: typeof fetch;
  },
): Promise<JudgePassResult> {
  const result: JudgePassResult = { skipped: 0, passed: 0, queued: 0, judged: 0, failed: 0, stopped: null };
  const now = options.now ?? (() => new Date());
  const profiles = new Map<string, Promise<LearnerProfile>>();
  const profileOf = (userId: string) => {
    let profile = profiles.get(userId);
    if (!profile) {
      profile = options.profileFor ? options.profileFor(userId) : loadLearnerProfile(learn, userId);
      profiles.set(userId, profile);
    }
    return profile;
  };
  const jevOn = new Map<string, Promise<boolean>>();
  const onJev = (userId: string) => {
    if (!VIDEO_JUDGE_ON_JEV || !options.jevEnabled) return Promise.resolve(false);
    let on = jevOn.get(userId);
    if (!on) jevOn.set(userId, (on = options.jevEnabled(userId)));
    return on;
  };
  const outOfTime = () => {
    if (Date.now() < options.deadline) return false;
    result.stopped = 'out of time; the next run carries on';
    return true;
  };

  // The first pass, a batch at a time for each person.
  const unscreened = await listVideos(learn, false);
  const byUser = new Map<string, ListVideo[]>();
  for (const video of unscreened) byUser.set(video.userId, [...(byUser.get(video.userId) ?? []), video]);
  screening: for (const [userId, videos] of byUser) {
    const profile = await profileOf(userId);
    for (let from = 0; from < videos.length; from += SCREEN_BATCH) {
      if (outOfTime()) break screening;
      const batch = videos.slice(from, from + SCREEN_BATCH);
      const { settled, rest } = await screenWithJev(
        batch,
        profile,
        await onJev(userId),
        (report) => options.onSpend?.(userId, 'screen', report),
        { apiKey: options.jevApiKey, fetch: options.jevFetch },
      );
      const rows: { videoId: string; decision: 'skip' | 'look'; why: string | null }[] = [...settled];
      if (rest.length > 0) {
        const screened = await screenVideos({
          profile,
          videos: rest,
          anthropicApiKey: options.anthropicApiKey,
          client: options.client,
          onSpend: options.onSpend ? (report) => options.onSpend!(userId, 'screen', report) : undefined,
        });
        if (!screened.ok) {
          result.failed += rest.length;
          console.error('[video judge] screening', screened.detail);
        } else {
          result.failed += rest.length - screened.screened.length;
          rows.push(...screened.screened);
        }
      }
      for (const row of rows) {
        const video = batch.find((candidate) => candidate.videoId === row.videoId)!;
        const stamp = now().toISOString();
        if (row.decision === 'skip') {
          await writeRow(learn, video, {
            verdict: 'skip',
            judge_verdict: 'skip',
            verdict_by: 'judge',
            why: row.why,
            judged_from: 'title',
            best_start_seconds: null,
            best_end_seconds: null,
            stretches: [],
            screened_at: stamp,
            judged_at: stamp,
            updated_at: stamp,
          });
          result.skipped += 1;
        } else {
          await writeRow(learn, video, { why: row.why, screened_at: stamp, updated_at: stamp });
          result.passed += 1;
        }
      }
    }
  }

  // The second pass: ask for what is missing, judge what is ready.
  const screened = await listVideos(learn, true);
  const statuses = await transcriptStatuses(learn, screened.map((video) => video.videoId));
  const toQueue: string[] = [];
  const ready: { video: ListVideo; from: 'transcript' | 'chapters' }[] = [];
  for (const video of screened) {
    const step = nextStep(video.durationSeconds, statuses.get(video.videoId) ?? null, MAX_ATTEMPTS);
    if (step === 'queue') toQueue.push(video.videoId);
    else if (step === 'transcript' || step === 'chapters') ready.push({ video, from: step });
  }
  if (toQueue.length > 0) result.queued = await queueTranscripts(learn, toQueue, 'list');

  const one = async ({ video, from }: { video: ListVideo; from: 'transcript' | 'chapters' }) => {
    const cues = from === 'transcript' ? (await loadTranscript(learn, video.videoId))?.cues ?? [] : [];
    const windows = cues.length > 0 ? transcriptWindows(cues, video.durationSeconds) : [];
    const judgedFrom = windows.length > 0 ? 'transcript' : 'chapters';
    const profile = await profileOf(video.userId);
    const toJudge: VideoToJudge = {
      title: video.title,
      channel: video.channel,
      durationSeconds: video.durationSeconds,
      description: video.description,
      summary: video.summary,
      keyPoints: video.keyPoints,
      from: judgedFrom,
      windows:
        judgedFrom === 'transcript' ? windows : chapterWindows(chaptersFromDescription(video.description ?? ''), video.durationSeconds),
    };
    const onSpend = options.onSpend ? (report: SpendReport) => options.onSpend!(video.userId, 'judge', report) : undefined;

    let settled: SettledVerdict | undefined;
    if ((await onJev(video.userId)) && !overrideFor(video, profile.filed)) {
      type Route = { by: 'jev'; verdict: Verdict; line: string } | { by: 'haiku' };
      const decided = await decideWithJev<typeof JUDGE_QUESTION, Route>({
        state: judgeState(profile, toJudge),
        question: JUDGE_QUESTION,
        read: (answer) => ({ by: 'jev', verdict: answer.choice, line: jevLine('judge', answer) }),
        fallback: async () => ({ by: 'haiku' }),
        onSpend,
        apiKey: options.jevApiKey,
        fetch: options.jevFetch,
      });
      const route = decided.value;
      if (route.by === 'jev' && route.verdict === 'skip') {
        const stamp = now().toISOString();
        await writeRow(learn, video, {
          verdict: 'skip',
          judge_verdict: 'skip',
          verdict_by: 'judge',
          why: route.line,
          judged_from: judgedFrom,
          best_start_seconds: null,
          best_end_seconds: null,
          stretches: [],
          judged_at: stamp,
          updated_at: stamp,
        });
        result.judged += 1;
        return;
      }
      if (route.by === 'jev' && route.verdict !== 'skip') settled = { verdict: route.verdict, line: route.line };
    }

    const judged = await judgeVideo({
      profile,
      video: toJudge,
      anthropicApiKey: options.anthropicApiKey,
      client: options.client,
      onSpend,
      settled,
    });
    if (judged.outcome === 'failed') {
      result.failed += 1;
      console.error(`[video judge] ${video.videoId}`, judged.detail);
      return;
    }
    const stamp = now().toISOString();
    await writeRow(learn, video, {
      verdict: judged.verdict,
      judge_verdict: judged.verdict,
      verdict_by: 'judge',
      why: judged.why,
      judged_from: judgedFrom,
      best_start_seconds: judged.bestStartSeconds,
      best_end_seconds: judged.bestEndSeconds,
      stretches: judged.stretches,
      judged_at: stamp,
      updated_at: stamp,
    });
    result.judged += 1;
  };

  let next = 0;
  const worker = async () => {
    while (next < ready.length) {
      if (outOfTime()) return;
      await one(ready[next++]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, ready.length) }, worker));
  return result;
}
