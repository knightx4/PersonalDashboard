import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { usageFrom, type SpendReport } from '@/lib/core/spend/pricing';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { loadGraph } from '@/lib/learn/graph/load';
import { rootingFor, type Rooting } from '@/lib/learn/graph/rooting';
import { forceTool, whyNoReport } from '@/lib/learn/graph/tool-call';
import {
  chaptersFromDescription,
  fetchPlaylistVideoIds,
  fetchVideosByIds,
  type YouTubeFailure,
  type YouTubeVideo,
} from '@/lib/learn/providers/youtube';
import { rootingLines } from './channel-search';
import { clockTime } from './format';
import {
  chapterWindows,
  JUDGE_VIDEO_MODEL,
  judgeVideo,
  nextStep,
  transcriptWindows,
  type JudgeWindow,
  type LearnerProfile,
  type Stretch,
  type TranscriptStatus,
  type Verdict,
} from './judge-video';
import { loadLearnerProfile } from './judging';
import { settleJudgedChannels, type LibraryWrites, type SettleResult } from './follow-channel';
import { keepGoodSamples } from './keep-samples';
import {
  loadTranscript,
  MAX_ATTEMPTS,
  queueTranscripts,
  transcribeVideos,
  type CallTrigger,
  type TranscribeResult,
} from './transcripts';

/**
 * Judging each channel found for a subject on three of its own videos (plan
 * #1196, under #1185).
 *
 * For each channel #1195 stored with no verdict:
 *
 * 1. Its uploads playlist is read, up to 200 videos (4 quota units), their
 *    titles and lengths fetched (4 more), and one Haiku call picks the three
 *    closest to the subject. The picks are stored on the row, so a channel is
 *    picked once whatever happens to its transcripts.
 * 2. The picks' transcripts are asked for with requested_by 'channel' and, on
 *    a press, fetched there and then inside the month's credits and at most
 *    MAX_CREDITS_PER_SUBJECT. What does not fit stays queued, and the
 *    scheduled run fetches it inside its own share of the allowance.
 * 3. Each pick whose transcript is in (or that will be read from its
 *    chapters, having no captions) goes through the video judge from #1066
 *    against the learner profile, and the result is added to `samples`.
 *    A sample judged watch or card is kept in the Videos section (#1197,
 *    keep-samples.ts) as it is judged, on a press and on the scheduled run.
 * 4. Once every pick has a sample, one more Haiku call reads the three
 *    verdicts and an excerpt of each transcript and marks the channel follow
 *    or pass, with a reason about the person's level in the subject.
 * 5. Every channel of the subject with a verdict and no decision is then
 *    followed into the YouTube library or marked passed (#1198,
 *    follow-channel.ts), on a press and on the scheduled run alike.
 *
 * A channel whose samples are not all in stays unjudged; the next press or
 * scheduled run carries on from where this one stopped. Database errors
 * throw; a model or YouTube failure is counted and left for the next run.
 */

export const CHANNEL_JUDGE_MODEL = JUDGE_VIDEO_MODEL;

/** Videos judged per channel. */
export const SAMPLES_PER_CHANNEL = 3;

/** Transcript credits one press may spend on a subject: three videos on five channels. */
export const MAX_CREDITS_PER_SUBJECT = 15;

/** Uploads read per channel, in pages of fifty: the latest 200. */
const UPLOAD_PAGES = 4;

/** Shorter than this is a Short or a trailer, and teaches nothing to judge. */
const MIN_SAMPLE_SECONDS = 120;

/** Transcript text from each sample the channel verdict reads. */
const EXCERPT_CHARS = 5_000;
const MAX_WHY = 600;
const MAX_DESCRIPTION = 1_500;

export type ChannelVerdict = 'follow' | 'pass';

/** A video picked to judge the channel by, as stored in `picks`. */
export type Pick = {
  video_id: string;
  title: string;
  duration_seconds: number | null;
  description: string | null;
};

/** A judged pick, as stored in `samples`. */
export type Sample = {
  video_id: string;
  title: string;
  verdict: Verdict;
  /** The judge's reason, about the person. */
  line: string;
  judged_from: 'transcript' | 'chapters';
  best_start_seconds: number | null;
  best_end_seconds: number | null;
  stretches: Stretch[];
};

function clip(text: string | null | undefined, limit: number): string {
  const tidy = (text ?? '').replace(/\s+/g, ' ').trim();
  return tidy.length <= limit ? tidy : `${tidy.slice(0, limit - 1)}…`;
}

/**
 * A channel's uploads playlist, which YouTube names after the channel: UC…
 * becomes UU…. Saves the channels.list call the library makes for it.
 */
export function uploadsPlaylistFor(channelId: string): string {
  return `UU${channelId.slice(2)}`;
}

// ---------------------------------------------------------------------------
// Picking three videos
// ---------------------------------------------------------------------------

const PICK_TOOL = 'report_picks';

const PICK_SYSTEM = `You are given a subject somebody is studying and the latest videos on one
YouTube channel, by title and length. Pick the ${SAMPLES_PER_CHANNEL} videos that teach this
subject most directly, so the channel can be judged on how it teaches it.

Prefer videos that explain part of the subject over news, vlogs, livestreams,
announcements and course adverts. Prefer a spread over three parts of one
series. If fewer than ${SAMPLES_PER_CHANNEL} videos are about the subject at all, pick only
those; if none are, pick none.`;

export function pickPrompt(input: { subject: string; note: string | null; channel: string; videos: YouTubeVideo[] }): string {
  const lines = [`Subject: ${input.subject}`];
  if (input.note?.trim()) lines.push(`Their note on it: ${clip(input.note, 300)}`);
  lines.push('', `Channel: ${input.channel}`, '', 'VIDEOS:');
  input.videos.forEach((video, index) => {
    const length = video.durationSeconds === null ? '' : ` (${clockTime(video.durationSeconds)})`;
    lines.push(`${index + 1}. ${clip(video.title, 140)}${length}`);
  });
  lines.push('', `Call ${PICK_TOOL} with the numbers of your picks.`);
  return lines.join('\n');
}

const pickReplySchema = z.object({ numbers: z.array(z.coerce.number().int()).default([]) });

/** The picks, matched back to the videos; repeats and numbers out of range dropped. */
export function readPickReply(input: unknown, videos: YouTubeVideo[]): Pick[] | null {
  const parsed = pickReplySchema.safeParse(input);
  if (!parsed.success) return null;
  const out: Pick[] = [];
  const seen = new Set<number>();
  for (const n of parsed.data.numbers) {
    const video = videos[n - 1];
    if (!video || seen.has(n)) continue;
    seen.add(n);
    out.push({
      video_id: video.videoId,
      title: video.title,
      duration_seconds: video.durationSeconds,
      description: video.description ? clip(video.description, MAX_DESCRIPTION) : null,
    });
    if (out.length === SAMPLES_PER_CHANNEL) break;
  }
  return out;
}

/** The videos worth offering to the pick: long enough to teach something. */
export function pickCandidates(videos: YouTubeVideo[]): YouTubeVideo[] {
  return videos.filter((video) => video.durationSeconds === null || video.durationSeconds >= MIN_SAMPLE_SECONDS);
}

async function pickVideos(input: {
  prompt: string;
  videos: YouTubeVideo[];
  client: Anthropic;
  onSpend?: (report: SpendReport) => void;
}): Promise<{ ok: true; picks: Pick[] } | { ok: false; detail: string }> {
  let response;
  try {
    response = await input.client.messages.create({
      model: CHANNEL_JUDGE_MODEL,
      max_tokens: 256,
      system: PICK_SYSTEM,
      tools: [
        {
          name: PICK_TOOL,
          description: 'Report the numbers of the videos picked, best first.',
          input_schema: {
            type: 'object',
            properties: { numbers: { type: 'array', items: { type: 'integer' }, maxItems: SAMPLES_PER_CHANNEL } },
            required: ['numbers'],
          },
        },
      ],
      tool_choice: forceTool(PICK_TOOL, CHANNEL_JUDGE_MODEL),
      messages: [{ role: 'user', content: input.prompt }],
    });
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : 'Picking the videos failed.' };
  }
  input.onSpend?.({ model: CHANNEL_JUDGE_MODEL, usage: usageFrom(response.usage) });
  const block = response.content.find((part) => part.type === 'tool_use' && part.name === PICK_TOOL);
  if (!block || block.type !== 'tool_use') return { ok: false, detail: whyNoReport(response) };
  const picks = readPickReply(block.input, input.videos);
  return picks ? { ok: true, picks } : { ok: false, detail: 'The picks came back malformed.' };
}

// ---------------------------------------------------------------------------
// The channel's verdict
// ---------------------------------------------------------------------------

const VERDICT_TOOL = 'report_channel_verdict';

const VERDICT_SYSTEM = `You decide whether a person should follow a YouTube channel to learn a subject
they are studying. You are told where they are in the subject, why the channel
was recommended, and how three of its videos on the subject were judged
against what they are learning, with an excerpt of what each video says.

FOLLOW when the channel explains the subject clearly, at the depth they are
at, without leaning on terms they have not met yet, and at least one of the
videos was worth watching or worth a card for them. PASS when it pitches the
subject too far above or below them, buries it in jargon or chatter, or
mostly teaches something else.

THE REASON is one or two sentences, at most 45 words, addressed to them as
"you". It says how the channel's teaching sits against their level in this
subject, naming what they already know or are about to learn: 'Explains
eigenvectors from the picture up, which is where you are after settling
matrix multiplication.' Never hype, no em dashes, and never claim you watched
more than the three videos.`;

export type SampleForVerdict = Sample & { excerpt: string | null };

export function verdictPrompt(input: {
  subject: string;
  note: string | null;
  rooting: Rooting;
  channel: string;
  foundWhy: string | null;
  samples: SampleForVerdict[];
}): string {
  const lines = [`Subject: ${input.subject}`];
  if (input.note?.trim()) lines.push('', `Their note on it: ${clip(input.note, 300)}`);
  lines.push(...rootingLines(input.rooting));
  lines.push('', `CHANNEL: ${input.channel}`);
  if (input.foundWhy?.trim()) lines.push(`Why it was recommended: ${clip(input.foundWhy, 600)}`);
  input.samples.forEach((sample, index) => {
    lines.push('', `VIDEO ${index + 1}: "${sample.title}"`);
    lines.push(`Judged ${sample.verdict.toUpperCase()}: ${sample.line}`);
    lines.push(sample.excerpt ? `What it says: ${sample.excerpt}` : 'No transcript; it was judged from its chapters.');
  });
  lines.push('', `Call ${VERDICT_TOOL}.`);
  return lines.join('\n');
}

const verdictReplySchema = z.object({ verdict: z.enum(['follow', 'pass']), why: z.string() });

export function readVerdictReply(input: unknown): { verdict: ChannelVerdict; why: string } | null {
  const parsed = verdictReplySchema.safeParse(input);
  if (!parsed.success) return null;
  const why = clip(parsed.data.why, MAX_WHY);
  return why ? { verdict: parsed.data.verdict, why } : null;
}

/** The start of the transcript, as the verdict reads it. */
export function excerptFrom(windows: JudgeWindow[]): string | null {
  const text = clip(windows.map((window) => window.text).join(' '), EXCERPT_CHARS);
  return text || null;
}

async function decideChannel(input: {
  prompt: string;
  client: Anthropic;
  onSpend?: (report: SpendReport) => void;
}): Promise<{ ok: true; verdict: ChannelVerdict; why: string } | { ok: false; detail: string }> {
  let response;
  try {
    response = await input.client.messages.create({
      model: CHANNEL_JUDGE_MODEL,
      max_tokens: 512,
      system: VERDICT_SYSTEM,
      tools: [
        {
          name: VERDICT_TOOL,
          description: 'Report follow or pass, and the reason.',
          input_schema: {
            type: 'object',
            properties: { verdict: { type: 'string', enum: ['follow', 'pass'] }, why: { type: 'string' } },
            required: ['verdict', 'why'],
          },
        },
      ],
      tool_choice: forceTool(VERDICT_TOOL, CHANNEL_JUDGE_MODEL),
      messages: [{ role: 'user', content: input.prompt }],
    });
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : 'Judging the channel failed.' };
  }
  input.onSpend?.({ model: CHANNEL_JUDGE_MODEL, usage: usageFrom(response.usage) });
  const block = response.content.find((part) => part.type === 'tool_use' && part.name === VERDICT_TOOL);
  if (!block || block.type !== 'tool_use') return { ok: false, detail: whyNoReport(response) };
  const read = readVerdictReply(block.input);
  return read ? { ok: true, ...read } : { ok: false, detail: 'The channel verdict came back malformed.' };
}

// ---------------------------------------------------------------------------
// One run over a subject's channels
// ---------------------------------------------------------------------------

type ChannelRow = {
  id: string;
  youtube_channel_id: string;
  title: string;
  found_why: string | null;
  picks: Pick[] | null;
  samples: Sample[];
};

/** Where a run's calls are reported: picking and the verdict apart from the video judge. */
export type ChannelJudgePass = 'pick' | 'sample' | 'verdict';

/** YouTube, replaceable in tests. */
export type UploadsSource = {
  playlist: (playlistId: string) => ReturnType<typeof fetchPlaylistVideoIds>;
  videos: (videoIds: string[]) => ReturnType<typeof fetchVideosByIds>;
};

const liveUploads: UploadsSource = {
  playlist: (playlistId) => fetchPlaylistVideoIds(playlistId, { maxPages: UPLOAD_PAGES }),
  videos: (videoIds) => fetchVideosByIds(videoIds),
};

export type JudgedChannel = { id: string; title: string; verdict: ChannelVerdict; why: string };

export type JudgeChannelsResult =
  | {
      ok: true;
      /** Channels given their picks this run. */
      picked: number;
      /** The transcript fetch this run made, or null when it made none. */
      transcripts: TranscribeResult | null;
      /** Picks judged this run. */
      sampled: number;
      /** Samples judged watch or card that went into the Videos section (#1197). */
      kept: number;
      judged: JudgedChannel[];
      /** Channels followed into the library or marked passed this run (#1198), or null when none were due. */
      settled: SettleResult | null;
      /** Channels still waiting on a transcript, for the next run. */
      waiting: number;
      /** Model calls that failed, left for the next run. */
      failed: number;
      quotaUnits: number;
      /** Why the run stopped before the channels did, or null. */
      stopped: string | null;
    }
  | { ok: false; reason: 'no-anthropic-key' | 'no-subject'; detail: string };

/**
 * Judge the unjudged channels found for one subject, as far as this run can.
 *
 * `maxCredits` is what this run may spend on transcripts: a press passes the
 * month's remaining credits (capped here at MAX_CREDITS_PER_SUBJECT), the
 * scheduled run passes 0 because it has already fetched the queue inside its
 * own allowance. Runs with the service client, since the transcript tables
 * belong to nobody; every read and write of subject_channels names `userId`.
 */
export async function judgeFoundChannels(input: {
  learn: LearnSupabaseClient;
  userId: string;
  subjectId: string;
  trigger: CallTrigger;
  maxCredits: number;
  deadline?: number;
  anthropicApiKey?: string | null;
  client?: Anthropic;
  profile?: LearnerProfile;
  uploads?: UploadsSource;
  transcribe?: typeof transcribeVideos;
  library?: LibraryWrites;
  onSpend?: (pass: ChannelJudgePass, report: SpendReport) => void;
  now?: () => Date;
}): Promise<JudgeChannelsResult> {
  const { learn, userId, subjectId } = input;
  const apiKey = input.anthropicApiKey ?? process.env.ANTHROPIC_API_KEY ?? null;
  if (!apiKey && !input.client) {
    return { ok: false, reason: 'no-anthropic-key', detail: 'Judging channels needs ANTHROPIC_API_KEY to be set.' };
  }
  const client = input.client ?? new Anthropic({ apiKey: apiKey ?? '' });
  const uploads = input.uploads ?? liveUploads;
  const now = input.now ?? (() => new Date());
  const spend = (pass: ChannelJudgePass) => (input.onSpend ? (report: SpendReport) => input.onSpend!(pass, report) : undefined);

  const subject = await learn
    .from('subjects')
    .select('id, name, note')
    .eq('id', subjectId)
    .eq('user_id', userId)
    .maybeSingle();
  if (subject.error) throw new Error(`Reading the subject failed: ${subject.error.message}`);
  if (!subject.data) return { ok: false, reason: 'no-subject', detail: 'That subject is not yours or no longer exists.' };
  const { name, note } = subject.data as { name: string; note: string | null };

  const rows = await learn
    .from('subject_channels')
    .select('id, youtube_channel_id, title, found_why, picks, samples')
    .eq('user_id', userId)
    .eq('subject_id', subjectId)
    .is('verdict', null)
    .order('created_at');
  if (rows.error) throw new Error(`Reading the channels to judge failed: ${rows.error.message}`);
  const channels = ((rows.data ?? []) as ChannelRow[]).map((row) => ({ ...row, samples: row.samples ?? [] }));

  const result = {
    ok: true as const,
    picked: 0,
    transcripts: null as TranscribeResult | null,
    sampled: 0,
    kept: 0,
    judged: [] as JudgedChannel[],
    settled: null as SettleResult | null,
    waiting: 0,
    failed: 0,
    quotaUnits: 0,
    stopped: null as string | null,
  };

  const outOfTime = () => {
    if (input.deadline === undefined || Date.now() < input.deadline) return false;
    result.stopped ??= 'ran out of time; the next run carries on';
    return true;
  };

  const write = async (channel: ChannelRow, update: Record<string, unknown>) => {
    const { error } = await learn
      .from('subject_channels')
      .update(update)
      .eq('id', channel.id)
      .eq('user_id', userId)
      .is('verdict', null);
    if (error) throw new Error(`Storing what was found about ${channel.title} failed: ${error.message}`);
  };

  // 1. Pick three videos for each channel that has none yet.
  for (const channel of channels) {
    if (channel.picks !== null) continue;
    if (outOfTime() || result.stopped) break;
    const listed = await uploads.playlist(uploadsPlaylistFor(channel.youtube_channel_id));
    let videos: YouTubeVideo[] = [];
    if (listed.ok) {
      result.quotaUnits += Math.max(1, Math.ceil(listed.videoIds.length / 50));
      if (listed.videoIds.length > 0) {
        const found = await uploads.videos(listed.videoIds);
        if (!found.ok) {
          result.stopped = youtubeStop(found);
          break;
        }
        result.quotaUnits += Math.ceil(listed.videoIds.length / 50);
        const byId = new Map(found.videos.map((video) => [video.videoId, video]));
        videos = pickCandidates(listed.videoIds.flatMap((id) => byId.get(id) ?? []));
      }
    } else if (listed.reason !== 'not-found') {
      result.stopped = youtubeStop(listed);
      break;
    }

    let picks: Pick[] = [];
    if (videos.length > 0) {
      const picked = await pickVideos({
        prompt: pickPrompt({ subject: name, note, channel: channel.title, videos }),
        videos,
        client,
        onSpend: spend('pick'),
      });
      if (!picked.ok) {
        result.failed += 1;
        console.error(`[channel judge] picking for ${channel.title}`, picked.detail);
        continue;
      }
      picks = picked.picks;
    }
    await write(channel, { picks });
    channel.picks = picks;
    result.picked += 1;
  }

  // 2. Ask for the picks' transcripts, and on a press fetch what fits.
  const unsampled = channels.flatMap((channel) =>
    (channel.picks ?? []).filter((pick) => !channel.samples.some((sample) => sample.video_id === pick.video_id)),
  );
  const wantedIds = [...new Set(unsampled.map((pick) => pick.video_id))];
  if (wantedIds.length > 0) {
    await queueTranscripts(learn, wantedIds, 'channel');
    const maxCredits = Math.min(input.maxCredits, MAX_CREDITS_PER_SUBJECT);
    if (maxCredits > 0 && !outOfTime()) {
      result.transcripts = await (input.transcribe ?? transcribeVideos)(learn, wantedIds, {
        trigger: input.trigger,
        maxCredits,
        deadline: input.deadline,
      });
    }
  }
  const statuses = await transcriptStatuses(learn, wantedIds);

  // 3 and 4. Judge what has arrived, then each channel whose picks are all judged.
  let profile: LearnerProfile | null = input.profile ?? null;
  let rooting: Rooting | null = null;
  for (const channel of channels) {
    if (channel.picks === null) continue;
    if (outOfTime()) break;

    const excerpts = new Map<string, string | null>();
    const samples = [...channel.samples];
    let added = 0;
    for (const pick of channel.picks) {
      if (samples.some((sample) => sample.video_id === pick.video_id)) continue;
      const step = nextStep(pick.duration_seconds, statuses.get(pick.video_id) ?? null, MAX_ATTEMPTS);
      if (step !== 'transcript' && step !== 'chapters') continue;
      if (outOfTime()) break;

      const cues = step === 'transcript' ? ((await loadTranscript(learn, pick.video_id))?.cues ?? []) : [];
      const windows = cues.length > 0 ? transcriptWindows(cues, pick.duration_seconds) : [];
      const from = windows.length > 0 ? 'transcript' : 'chapters';
      profile ??= await loadLearnerProfile(learn, userId);
      const judged = await judgeVideo({
        profile,
        video: {
          title: pick.title,
          channel: channel.title,
          durationSeconds: pick.duration_seconds,
          description: pick.description,
          summary: null,
          keyPoints: [],
          from,
          windows: from === 'transcript' ? windows : chapterWindows(chaptersFromDescription(pick.description ?? ''), pick.duration_seconds),
        },
        anthropicApiKey: apiKey ?? '',
        client,
        onSpend: spend('sample'),
      });
      if (judged.outcome === 'failed') {
        result.failed += 1;
        console.error(`[channel judge] ${pick.video_id}`, judged.detail);
        continue;
      }
      samples.push({
        video_id: pick.video_id,
        title: pick.title,
        verdict: judged.verdict,
        line: judged.why,
        judged_from: from,
        best_start_seconds: judged.bestStartSeconds,
        best_end_seconds: judged.bestEndSeconds,
        stretches: judged.stretches,
      });
      excerpts.set(pick.video_id, from === 'transcript' ? excerptFrom(windows) : null);
      added += 1;
    }

    // In the order they were picked, so the page lists them the same way every time.
    const ordered = channel.picks.flatMap((pick) => samples.find((sample) => sample.video_id === pick.video_id) ?? []);
    if (added > 0) {
      // Kept before the samples are stored, so a keep that fails is tried
      // again by the next run rather than lost behind a stored sample.
      const fresh = ordered.filter((sample) => !channel.samples.some((known) => known.video_id === sample.video_id));
      result.kept += await keepGoodSamples(learn, {
        userId,
        subjectId,
        channel,
        picks: channel.picks,
        samples: fresh,
        now: now(),
      });
      await write(channel, { samples: ordered });
      channel.samples = ordered;
      result.sampled += added;
    }

    if (ordered.length < channel.picks.length) {
      result.waiting += 1;
      continue;
    }
    if (outOfTime()) break;

    let verdict: { verdict: ChannelVerdict; why: string };
    if (channel.picks.length === 0) {
      verdict = { verdict: 'pass', why: `None of its latest uploads teach ${name}, so there was nothing to judge it on.` };
    } else {
      for (const sample of ordered) {
        if (excerpts.has(sample.video_id)) continue;
        const stored = sample.judged_from === 'transcript' ? await loadTranscript(learn, sample.video_id) : null;
        excerpts.set(sample.video_id, stored ? excerptFrom(transcriptWindows(stored.cues, null)) : null);
      }
      rooting ??= rootingFor(await loadGraph(learn, subjectId, userId), null);
      const decided = await decideChannel({
        prompt: verdictPrompt({
          subject: name,
          note,
          rooting,
          channel: channel.title,
          foundWhy: channel.found_why,
          samples: ordered.map((sample) => ({ ...sample, excerpt: excerpts.get(sample.video_id) ?? null })),
        }),
        client,
        onSpend: spend('verdict'),
      });
      if (!decided.ok) {
        result.failed += 1;
        console.error(`[channel judge] deciding ${channel.title}`, decided.detail);
        continue;
      }
      verdict = { verdict: decided.verdict, why: decided.why };
    }
    await write(channel, { verdict: verdict.verdict, why: verdict.why, judged_at: now().toISOString() });
    result.judged.push({ id: channel.id, title: channel.title, ...verdict });
  }

  // 5. Follow or pass what has a verdict, including channels judged by an
  // earlier run whose following YouTube refused.
  if (!outOfTime()) {
    const settled = await settleJudgedChannels(learn, {
      userId,
      subjectId,
      deadline: input.deadline,
      now,
      library: input.library,
    });
    if (settled.followed.length + settled.passed + settled.failed.length > 0) result.settled = settled;
  }

  return result;
}

function youtubeStop(failure: YouTubeFailure): string {
  if (failure.reason === 'no-key') return 'YOUTUBE_API_KEY is not set, so no channel could be read.';
  if (failure.reason === 'quota') return 'YouTube refused: the daily quota is spent. The next run carries on.';
  return `YouTube did not answer: ${failure.detail}`;
}

async function transcriptStatuses(learn: LearnSupabaseClient, videoIds: string[]): Promise<Map<string, TranscriptStatus>> {
  const out = new Map<string, TranscriptStatus>();
  if (videoIds.length === 0) return out;
  const { data, error } = await learn.from('video_transcripts').select('video_id, state, attempts').in('video_id', videoIds);
  if (error) throw new Error(`Reading transcript states failed: ${error.message}`);
  for (const row of (data ?? []) as { video_id: string; state: 'queued' | 'fetched' | 'none' | 'failed'; attempts: number }[]) {
    out.set(row.video_id, { state: row.state, attempts: row.attempts });
  }
  return out;
}

/**
 * The scheduled run's pass: every subject with a channel still unjudged, or
 * judged and not yet followed or passed, for everybody, with no transcript fetching of its own. Channels picked here are
 * judged on a later run, once their transcripts are in.
 */
export async function judgePendingChannels(
  learn: LearnSupabaseClient,
  options: {
    anthropicApiKey: string;
    deadline: number;
    client?: Anthropic;
    onSpend?: (userId: string, pass: ChannelJudgePass, report: SpendReport) => void;
  },
): Promise<{
  subjects: number;
  judged: number;
  kept: number;
  followed: number;
  waiting: number;
  failed: number;
  stopped: string | null;
}> {
  const out = { subjects: 0, judged: 0, kept: 0, followed: 0, waiting: 0, failed: 0, stopped: null as string | null };
  // No decision covers the unjudged channels and the judged ones not yet
  // followed or passed (#1198).
  const { data, error } = await learn.from('subject_channels').select('user_id, subject_id').is('decided', null);
  if (error) throw new Error(`Reading the channels waiting to be judged failed: ${error.message}`);
  const pairs = new Map<string, { user_id: string; subject_id: string }>();
  for (const row of (data ?? []) as { user_id: string; subject_id: string }[]) pairs.set(`${row.user_id}:${row.subject_id}`, row);

  for (const { user_id: userId, subject_id: subjectId } of pairs.values()) {
    if (Date.now() >= options.deadline) {
      out.stopped = 'ran out of time; the next run carries on';
      break;
    }
    const run = await judgeFoundChannels({
      learn,
      userId,
      subjectId,
      trigger: 'scheduled',
      maxCredits: 0,
      deadline: options.deadline,
      anthropicApiKey: options.anthropicApiKey,
      client: options.client,
      onSpend: options.onSpend ? (pass, report) => options.onSpend!(userId, pass, report) : undefined,
    });
    out.subjects += 1;
    if (!run.ok) continue;
    out.judged += run.judged.length;
    out.kept += run.kept;
    out.followed += run.settled?.followed.length ?? 0;
    out.waiting += run.waiting;
    out.failed += run.failed + (run.settled?.failed.length ?? 0);
    if (run.stopped) out.stopped = run.stopped;
  }
  return out;
}
