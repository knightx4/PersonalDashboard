import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import { segmentsFromCues, type Chapter, type TranscriptCue } from '@/lib/learn/catalogue/segment';
import { forceTool, whyNoReport } from '@/lib/learn/graph/tool-call';
import { clockTime } from './format';
import { MODELS } from '@/lib/core/models';

/**
 * Judging the videos on your list against what you are learning (plan #1066).
 *
 * Two passes, both Haiku, or Jev first for an account that opted in
 * (judging.ts, plan #1170). The screen reads a batch of videos by title,
 * channel, length and description (or the summary already written from it)
 * and throws out the clear skips, so a video that is plainly not for you
 * never costs a transcript credit. Everything it lets through is judged a
 * second time, one video per call, from the transcript cut into windows of a
 * few minutes, and settles into watch, card or skip. A video over two hours,
 * or one with no captions, is judged from its chapters instead.
 *
 * Every reason has to name the track, goal or idea the video serves, or say
 * which of them it misses, so the verdict reads as being about you rather
 * than about the video.
 *
 * The calls are here and the database is in judging.ts, so the prompt, the
 * reply checks and the arithmetic from windows to minutes are tested without
 * either.
 */

export const JUDGE_VIDEO_MODEL = MODELS.learnJudgeVideo;

/** Videos read per screening call: the profile is sent once for all of them. */
export const SCREEN_BATCH = 10;

/** A video longer than this is judged from its chapters, not its transcript. */
export const LONG_VIDEO_SECONDS = 2 * 3600;

/** How much of a description the screen reads per video. */
const SCREEN_DESCRIPTION_CHARS = 1_200;

/** The transcript windows sent to the second pass, all told. */
const WINDOW_TEXT_BUDGET = 60_000;
const MIN_WINDOW_CHARS = 400;

export type Verdict = 'watch' | 'card' | 'skip';

// ---------------------------------------------------------------------------
// What Learn knows about you
// ---------------------------------------------------------------------------

export type LearnerProfile = {
  /** Your tracks, each with where you are in it. `id` is the learn.subjects row, where it was read. */
  tracks: { id?: string; name: string; note: string | null; frontier: string[]; settled: number }[];
  /** Open goals from Goals. `id` is the goals.items row, where it was read. */
  goals: { id?: string; title: string; detail: string | null }[];
  /** Ideas from Learn now, by the theme each belongs to. */
  ideas: { theme: string; names: string[] }[];
  /**
   * Videos you filed yourself on the Videos page (#1068), newest first: what
   * the judge said, if it had read the video, and where you put it. Read by
   * both passes as examples of what you disagree with.
   */
  filed?: FiledVideo[];
};

export type FiledVideo = { title: string; channel: string | null; judge: Verdict | null; you: Verdict };

export function isEmptyProfile(profile: LearnerProfile): boolean {
  return profile.tracks.length === 0 && profile.goals.length === 0 && profile.ideas.length === 0;
}

function clip(text: string | null | undefined, limit: number): string {
  const tidy = (text ?? '').replace(/\s+/g, ' ').trim();
  return tidy.length <= limit ? tidy : `${tidy.slice(0, limit - 1)}…`;
}

/** The profile as the prompt reads it. */
export function profileText(profile: LearnerProfile): string {
  const lines: string[] = [];
  lines.push('TRACKS (what they are studying):');
  if (profile.tracks.length === 0) lines.push('- none');
  for (const track of profile.tracks) {
    const note = track.note ? ` (${clip(track.note, 160)})` : '';
    lines.push(`- Track "${track.name}"${note}. ${track.settled} ideas settled.`);
    if (track.frontier.length > 0) lines.push(`  Where they are now: ${track.frontier.map((claim) => clip(claim, 140)).join(' | ')}`);
  }
  lines.push('', 'GOALS (open, from their Goals page):');
  if (profile.goals.length === 0) lines.push('- none');
  for (const goal of profile.goals) {
    const detail = goal.detail ? `: ${clip(goal.detail, 160)}` : '';
    lines.push(`- Goal "${goal.title}"${detail}`);
  }
  lines.push('', 'IDEAS (from their Learn now feed, by theme):');
  if (profile.ideas.length === 0) lines.push('- none');
  for (const idea of profile.ideas) lines.push(`- Theme "${idea.theme}": ${idea.names.map((name) => clip(name, 80)).join('; ')}`);
  const filed = profile.filed ?? [];
  if (filed.length > 0) {
    lines.push('', 'VIDEOS THEY FILED THEMSELVES (where the sorting got it wrong; judge videos like these the way they did):');
    for (const video of filed) {
      const channel = video.channel ? ` (${clip(video.channel, 60)})` : '';
      const judge = video.judge && video.judge !== video.you ? `judged ${video.judge.toUpperCase()}, they moved it to ` : '';
      lines.push(`- "${clip(video.title, 120)}"${channel}: ${judge}${video.you.toUpperCase()}`);
    }
  }
  return lines.join('\n');
}

const REASON_RULES = `THE REASON is one sentence, at most 30 words, about the person rather than
the video. It names, in its own words and inside quotation marks, the track,
goal or theme the video serves: 'Serves your "Startup Finance / FP&A" track:
walks through a three-statement model.' For a skip it names what the video
misses, or says it touches none of them: 'Touches none of your tracks, goals
or ideas; a gaming stream.' Never "this video", never hype, no em dashes.`;

// ---------------------------------------------------------------------------
// The first pass: title, description and length
// ---------------------------------------------------------------------------

export type VideoToScreen = {
  videoId: string;
  title: string;
  channel: string | null;
  durationSeconds: number | null;
  description: string | null;
  /** The summary already written for the list (#1069), read instead of the description. */
  summary: string | null;
};

export type Screened = { videoId: string; decision: 'skip' | 'look'; why: string };

const SCREEN_TOOL = 'report_screen';

const SCREEN_SYSTEM = `You sort videos a person saved to watch later, using only each video's title,
channel, length and description. You are told what they are learning. Decide
for each video whether it is a clear skip or worth a closer look at its
transcript, which costs money.

SKIP only when the title and description make it plain the video serves none
of their tracks, goals or ideas: entertainment, news with no lasting point, a
topic far from all of them. LOOK when it plausibly serves one, or when you
cannot tell. A closer look is cheap next to throwing out something they
wanted, so when in doubt, LOOK.

${REASON_RULES}

Report every video you were given, by its number.`;

export function screenPrompt(profile: LearnerProfile, videos: VideoToScreen[]): string {
  const lines = [profileText(profile), '', 'VIDEOS:'];
  videos.forEach((video, index) => {
    lines.push('', `${index + 1}. "${video.title}"`);
    if (video.channel) lines.push(`   Channel: ${video.channel}`);
    if (video.durationSeconds !== null) lines.push(`   Length: ${clockTime(video.durationSeconds)}`);
    const about = video.summary ? `Summary: ${clip(video.summary, SCREEN_DESCRIPTION_CHARS)}` : `Description: ${clip(video.description, SCREEN_DESCRIPTION_CHARS) || '(none)'}`;
    lines.push(`   ${about}`);
  });
  lines.push('', `Call ${SCREEN_TOOL}.`);
  return lines.join('\n');
}

const screenReplySchema = z.object({
  videos: z.array(
    z.object({
      number: z.coerce.number().int(),
      decision: z.enum(['skip', 'look']),
      why: z.string(),
    }),
  ),
});

/**
 * The screen's reply, matched back to the videos. A video the reply left out
 * or gave no reason for is not in the result, so the next run reads it again.
 */
export function readScreenReply(input: unknown, videos: VideoToScreen[]): Screened[] {
  const parsed = screenReplySchema.safeParse(input);
  if (!parsed.success) return [];
  const seen = new Set<string>();
  const out: Screened[] = [];
  for (const row of parsed.data.videos) {
    const video = videos[row.number - 1];
    const why = row.why.trim();
    if (!video || !why || seen.has(video.videoId)) continue;
    seen.add(video.videoId);
    out.push({ videoId: video.videoId, decision: row.decision, why });
  }
  return out;
}

export type ScreenResult = { ok: true; screened: Screened[] } | { ok: false; detail: string };

/** Screen one batch. Never throws. */
export async function screenVideos(input: {
  profile: LearnerProfile;
  videos: VideoToScreen[];
  anthropicApiKey: string;
  client?: Anthropic;
  onSpend?: SpendSink;
}): Promise<ScreenResult> {
  if (input.videos.length === 0) return { ok: true, screened: [] };
  const client = input.client ?? new Anthropic({ apiKey: input.anthropicApiKey });
  let response;
  try {
    response = await client.messages.create({
      model: JUDGE_VIDEO_MODEL,
      max_tokens: 2048,
      system: SCREEN_SYSTEM,
      tools: [
        {
          name: SCREEN_TOOL,
          description: 'Report skip or look, with the reason, for every video.',
          input_schema: {
            type: 'object',
            properties: {
              videos: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    number: { type: 'integer' },
                    decision: { type: 'string', enum: ['skip', 'look'] },
                    why: { type: 'string' },
                  },
                  required: ['number', 'decision', 'why'],
                },
              },
            },
            required: ['videos'],
          },
        },
      ],
      tool_choice: forceTool(SCREEN_TOOL),
      messages: [{ role: 'user', content: screenPrompt(input.profile, input.videos) }],
    });
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : 'Screening the videos failed.' };
  }
  input.onSpend?.({ model: JUDGE_VIDEO_MODEL, usage: usageFrom(response.usage) });
  const block = response.content.find((part) => part.type === 'tool_use' && part.name === SCREEN_TOOL);
  if (!block || block.type !== 'tool_use') return { ok: false, detail: whyNoReport(response) };
  return { ok: true, screened: readScreenReply(block.input, input.videos) };
}

// ---------------------------------------------------------------------------
// The second pass: the transcript's windows, or the chapters
// ---------------------------------------------------------------------------

/** One stretch of the video the second pass reads, numbered from 1 in the prompt. */
export type JudgeWindow = { startSeconds: number; endSeconds: number | null; text: string };

/** A stretch the verdict drew on, as stored in watch_list.stretches. */
export type Stretch = { startSeconds: number; endSeconds: number | null; point: string };

/**
 * The transcript cut into the same windows the catalogue uses (about four and
 * a half minutes, overlapping by thirty seconds), each window's text trimmed
 * so the whole fits the budget.
 */
export function transcriptWindows(cues: readonly TranscriptCue[], durationSeconds: number | null): JudgeWindow[] {
  const segments = segmentsFromCues([...cues]);
  if (segments.length === 0) return [];
  const perWindow = Math.max(MIN_WINDOW_CHARS, Math.floor(WINDOW_TEXT_BUDGET / segments.length));
  const last = segments.length - 1;
  return segments.map((segment, index) => {
    // The last cue has no end of its own, so the last window runs to the end of the video.
    const end = index === last && durationSeconds !== null ? Math.max(segment.tEndSeconds ?? 0, durationSeconds) : segment.tEndSeconds;
    return {
      startSeconds: segment.tStartSeconds ?? 0,
      endSeconds: end ?? segments[index + 1]?.tStartSeconds ?? null,
      text: clip(segment.text, perWindow),
    };
  });
}

/**
 * The chapters as windows, each running to the next; with no chapters, the
 * whole video as one window.
 */
export function chapterWindows(chapters: readonly Chapter[], durationSeconds: number | null): JudgeWindow[] {
  if (chapters.length === 0) return [{ startSeconds: 0, endSeconds: durationSeconds, text: '(the whole video; it has no chapters)' }];
  return chapters.map((chapter, index) => ({
    startSeconds: chapter.startSeconds,
    endSeconds: chapters[index + 1]?.startSeconds ?? durationSeconds,
    text: chapter.title,
  }));
}

export type VideoToJudge = {
  title: string;
  channel: string | null;
  durationSeconds: number | null;
  description: string | null;
  summary: string | null;
  keyPoints: string[];
  from: 'transcript' | 'chapters';
  windows: JudgeWindow[];
};

const JUDGE_TOOL = 'report_verdict';

const JUDGE_SYSTEM = `You judge one video a person saved to watch later, against what they are
learning. You have its title, its summary or description, and the video cut
into numbered windows with their times: either stretches of transcript or its
chapter titles.

Choose one verdict:
- WATCH: a stretch of it is worth their time as video, because it shows
  something (a demonstration, a worked example, an argument built up) that a
  card could not carry, and it serves a track, goal or idea of theirs. Name
  the best stretch as the first and last window of it, as short as does the
  job, rarely more than a third of the video.
- CARD: it serves them, but what is worth keeping is a few points that read
  as well as they watch. List the windows those points are in, one to five,
  each with the point in one sentence.
- SKIP: it serves none of their tracks, goals or ideas, or says nothing they
  would not already know.

For WATCH, also list the windows in the stretch with what each shows, one
sentence each.

${REASON_RULES}`;

export function judgePrompt(profile: LearnerProfile, video: VideoToJudge): string {
  const lines = [profileText(profile), '', `VIDEO: "${video.title}"`];
  if (video.channel) lines.push(`Channel: ${video.channel}`);
  if (video.durationSeconds !== null) lines.push(`Length: ${clockTime(video.durationSeconds)}`);
  if (video.summary) {
    lines.push(`Summary: ${video.summary}`);
    if (video.keyPoints.length > 0) lines.push(`Key points: ${video.keyPoints.join(' | ')}`);
  } else {
    lines.push(`Description: ${clip(video.description, 2_000) || '(none)'}`);
  }
  lines.push('', video.from === 'transcript' ? 'TRANSCRIPT WINDOWS:' : 'CHAPTERS (there is no transcript to read):');
  video.windows.forEach((window, index) => {
    const end = window.endSeconds === null ? 'end' : clockTime(window.endSeconds);
    lines.push(`[${index + 1}] ${clockTime(window.startSeconds)}-${end}: ${window.text}`);
  });
  lines.push('', `Call ${JUDGE_TOOL}.`);
  return lines.join('\n');
}

/**
 * A verdict Jev has already given (plan #1170), for which Haiku only names
 * the windows: the stretch for a watch, the points for a card. `line` is
 * the reason stored for a card, which Haiku is not asked to write, and for a
 * watch whose reason comes back empty.
 */
export type SettledVerdict = { verdict: 'watch' | 'card'; line: string };

/** What the system prompt gains when the verdict is already settled. */
export function settledRules(settled: SettledVerdict): string {
  return settled.verdict === 'watch'
    ? `THE VERDICT IS SETTLED: WATCH. Report WATCH, name the best stretch, list
its windows, and write the reason.`
    : `THE VERDICT IS SETTLED: CARD. Report CARD and list the windows worth a
card, each with its point. Leave the reason empty.`;
}

const judgeReplySchema = z.object({
  verdict: z.enum(['watch', 'card', 'skip']),
  why: z.string().optional().default(''),
  best_from: z.coerce.number().int().optional().nullable(),
  best_to: z.coerce.number().int().optional().nullable(),
  windows: z
    .array(z.object({ window: z.coerce.number().int(), point: z.string() }))
    .optional()
    .default([]),
});

export type Judged =
  | {
      outcome: 'judged';
      verdict: Verdict;
      why: string;
      bestStartSeconds: number | null;
      bestEndSeconds: number | null;
      stretches: Stretch[];
    }
  | { outcome: 'failed'; detail: string };

/**
 * The verdict, with window numbers turned into seconds.
 *
 * A watch verdict must name its stretch in windows that exist; one that does
 * not is refused rather than stored with no minute to start from. The end is
 * the last window's end, or the video's length when that window runs to the
 * end. Card windows outside the list are dropped, and a card verdict left with
 * none is refused for the same reason: #1067 has nothing to write from.
 */
export function readJudgeReply(
  input: unknown,
  windows: readonly JudgeWindow[],
  durationSeconds: number | null,
  settled?: SettledVerdict,
): Judged {
  const parsed = judgeReplySchema.safeParse(input);
  if (!parsed.success) return { outcome: 'failed', detail: 'The verdict came back malformed.' };
  const reply = settled ? { ...parsed.data, verdict: settled.verdict } : parsed.data;
  // A settled card's reason is Jev's line, whatever Haiku wrote (the step's own rule).
  const why = settled?.verdict === 'card' ? settled.line : reply.why.trim() || settled?.line || '';
  if (!why) return { outcome: 'failed', detail: 'The verdict came back with no reason.' };

  const at = (n: number | null | undefined) => (n && n >= 1 && n <= windows.length ? windows[n - 1] : null);
  const listed: Stretch[] = [];
  const seen = new Set<number>();
  for (const row of [...reply.windows].sort((a, b) => a.window - b.window)) {
    const window = at(row.window);
    if (!window || !row.point.trim() || seen.has(row.window)) continue;
    seen.add(row.window);
    listed.push({ startSeconds: window.startSeconds, endSeconds: window.endSeconds ?? durationSeconds, point: row.point.trim() });
  }

  if (reply.verdict === 'skip') {
    return { outcome: 'judged', verdict: 'skip', why, bestStartSeconds: null, bestEndSeconds: null, stretches: [] };
  }

  if (reply.verdict === 'card') {
    if (listed.length === 0) return { outcome: 'failed', detail: 'A card verdict named no window to make a card from.' };
    return { outcome: 'judged', verdict: 'card', why, bestStartSeconds: null, bestEndSeconds: null, stretches: listed.slice(0, 5) };
  }

  const first = at(reply.best_from);
  const last = at(reply.best_to ?? reply.best_from);
  if (!first || !last) return { outcome: 'failed', detail: 'A watch verdict named no stretch.' };
  const [from, to] = first.startSeconds <= last.startSeconds ? [first, last] : [last, first];
  const start = Math.round(from.startSeconds);
  const endRaw = to.endSeconds ?? durationSeconds;
  const end = endRaw !== null && Math.round(endRaw) > start ? Math.round(endRaw) : null;
  const inside = listed.filter((stretch) => stretch.startSeconds >= from.startSeconds && stretch.startSeconds <= to.startSeconds);
  return {
    outcome: 'judged',
    verdict: 'watch',
    why,
    bestStartSeconds: start,
    bestEndSeconds: end,
    stretches: inside.length > 0 ? inside : [{ startSeconds: start, endSeconds: end, point: why }],
  };
}

/** Judge one video, or name the windows for a verdict Jev settled. Never throws. */
export async function judgeVideo(input: {
  profile: LearnerProfile;
  video: VideoToJudge;
  anthropicApiKey: string;
  client?: Anthropic;
  onSpend?: SpendSink;
  settled?: SettledVerdict;
}): Promise<Judged> {
  if (input.video.windows.length === 0) return { outcome: 'failed', detail: 'Nothing to judge the video from.' };
  const client = input.client ?? new Anthropic({ apiKey: input.anthropicApiKey });
  let response;
  try {
    response = await client.messages.create({
      model: JUDGE_VIDEO_MODEL,
      max_tokens: 1024,
      system: input.settled ? `${JUDGE_SYSTEM}\n\n${settledRules(input.settled)}` : JUDGE_SYSTEM,
      tools: [
        {
          name: JUDGE_TOOL,
          description: 'Report the verdict, the reason, and the windows it rests on.',
          input_schema: {
            type: 'object',
            properties: {
              verdict: { type: 'string', enum: ['watch', 'card', 'skip'] },
              why: { type: 'string' },
              best_from: { type: 'integer', description: 'WATCH only: the first window of the best stretch.' },
              best_to: { type: 'integer', description: 'WATCH only: the last window of the best stretch.' },
              windows: {
                type: 'array',
                description: 'WATCH: the windows in the stretch. CARD: the windows worth a card. SKIP: empty.',
                items: {
                  type: 'object',
                  properties: { window: { type: 'integer' }, point: { type: 'string' } },
                  required: ['window', 'point'],
                },
              },
            },
            required: input.settled?.verdict === 'card' ? ['verdict'] : ['verdict', 'why'],
          },
        },
      ],
      tool_choice: forceTool(JUDGE_TOOL),
      messages: [{ role: 'user', content: judgePrompt(input.profile, input.video) }],
    });
  } catch (error) {
    return { outcome: 'failed', detail: error instanceof Error ? error.message : 'Judging the video failed.' };
  }
  input.onSpend?.({ model: JUDGE_VIDEO_MODEL, usage: usageFrom(response.usage) });
  const block = response.content.find((part) => part.type === 'tool_use' && part.name === JUDGE_TOOL);
  if (!block || block.type !== 'tool_use') return { outcome: 'failed', detail: whyNoReport(response) };
  return readJudgeReply(block.input, input.video.windows, input.video.durationSeconds, input.settled);
}

// ---------------------------------------------------------------------------
// Which way a screened video goes next
// ---------------------------------------------------------------------------

export type TranscriptStatus = { state: 'queued' | 'fetched' | 'none' | 'failed'; attempts: number } | null;

/**
 * What to do with a video the screen let through.
 *
 * - `chapters` for a video over two hours, whatever its transcript: reading
 *   one is several credits' worth of text. Also for one with no captions, or
 *   whose fetch has failed as often as the queue will try.
 * - `transcript` once the words are stored.
 * - `queue` when nothing has asked for its transcript yet.
 * - `wait` while it is queued; the run's allowance decides when it arrives.
 */
export function nextStep(
  durationSeconds: number | null,
  transcript: TranscriptStatus,
  maxAttempts: number,
): 'chapters' | 'transcript' | 'queue' | 'wait' {
  if (transcript?.state === 'fetched') return durationSeconds !== null && durationSeconds > LONG_VIDEO_SECONDS ? 'chapters' : 'transcript';
  if (durationSeconds !== null && durationSeconds > LONG_VIDEO_SECONDS) return 'chapters';
  if (transcript === null) return 'queue';
  if (transcript.state === 'none') return 'chapters';
  if (transcript.state === 'failed' && transcript.attempts >= maxAttempts) return 'chapters';
  return 'wait';
}
