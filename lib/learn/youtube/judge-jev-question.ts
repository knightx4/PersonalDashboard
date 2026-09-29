import type { JevChoiceAnswer, JevState } from '@/lib/jev/client';
import { clockTime } from './format';
import type { FiledVideo, JudgeWindow, LearnerProfile, VideoToJudge, VideoToScreen } from './judge-video';

/**
 * The video judge's two passes as Jev questions (plan #1170).
 *
 * judge-video.ts asks Haiku to screen ten videos a call as skip or look, and
 * then to judge each one let through as watch, card or skip. Here each is one
 * choice question per video, with every option worded from what the Haiku
 * prompt says that answer means, because the job-email trial found Jev weak
 * where a label's wording and the pipeline's meaning drifted apart.
 *
 * Jev reads no examples, so the videos you filed yourself (#1068), which
 * Haiku reads as examples, become a rule on top instead: a video from a
 * channel, or on a topic, you filed against the judge is never settled by
 * Jev. It goes to Haiku, which reads your filings (overrideFor).
 *
 * Jev writes no reason. A watch verdict still gets Haiku's one sentence,
 * since Haiku names its stretch anyway; a skip or a card gets a short line
 * saying what was judged and how sure (jevLine).
 */

/**
 * Whether the judge asks Jev at all. An account also has to have opted in
 * (lib/jev/enabled.ts). Setting this to false puts every account back on
 * Haiku alone.
 */
export const VIDEO_JUDGE_ON_JEV = true;

export type ScreenLabel = 'skip' | 'look';
export type JudgeLabel = 'watch' | 'card' | 'skip';

export const SCREEN_QUESTION = {
  type: 'choice',
  question:
    'The learner saved this video to watch later. From its title, channel, length and description alone, is it a clear skip, or worth a closer look at its transcript? A closer look costs money but is cheap next to throwing out something they wanted, so when in doubt, look.',
  options: {
    skip: 'A clear skip: the title and description make it plain the video serves none of their tracks, goals or ideas. Entertainment, news with no lasting point, or a topic far from all of them.',
    look: 'Worth a closer look: it plausibly serves one of their tracks, goals or ideas, or the title and description do not make it plain either way.',
  },
} as const satisfies { type: 'choice'; question: string; options: Record<ScreenLabel, string> };

export const JUDGE_QUESTION = {
  type: 'choice',
  question:
    'The learner saved this video to watch later. Judge it against what they are learning, from its title, its summary or description, and the video cut into numbered windows with their times (stretches of transcript, or its chapter titles).',
  options: {
    watch:
      'Watch: a stretch of it is worth their time as video, because it shows something a card could not carry (a demonstration, a worked example, an argument built up), and it serves one of their tracks, goals or ideas.',
    card: 'Card: it serves one of their tracks, goals or ideas, but what is worth keeping is a few points that read as well as they watch.',
    skip: 'Skip: it serves none of their tracks, goals or ideas, or says nothing they would not already know.',
  },
} as const satisfies { type: 'choice'; question: string; options: Record<JudgeLabel, string> };

/** What the learner is studying, as Jev reads it. Their filings are left out: see overrideFor. */
export function learnerState(profile: LearnerProfile): Record<string, unknown> {
  return {
    tracks: profile.tracks.map((track) => ({
      name: track.name,
      ...(track.note ? { note: track.note } : {}),
      where_they_are: track.frontier,
      ideas_settled: track.settled,
    })),
    goals: profile.goals.map((goal) => (goal.detail ? { goal: goal.title, detail: goal.detail } : { goal: goal.title })),
    ideas_by_theme: profile.ideas.map((idea) => ({ theme: idea.theme, ideas: idea.names })),
  };
}

function length(durationSeconds: number | null): Record<string, string> {
  return durationSeconds === null ? {} : { length: clockTime(durationSeconds) };
}

/** Descriptions are clipped as the screen prompt clips them. */
const SCREEN_DESCRIPTION_CHARS = 1_200;

export function screenState(profile: LearnerProfile, video: VideoToScreen): JevState {
  const about = video.summary
    ? { summary: video.summary.slice(0, SCREEN_DESCRIPTION_CHARS) }
    : { description: (video.description ?? '').slice(0, SCREEN_DESCRIPTION_CHARS) || '(none)' };
  return {
    learner: learnerState(profile),
    video: { title: video.title, ...(video.channel ? { channel: video.channel } : {}), ...length(video.durationSeconds), ...about },
  };
}

function windowLine(window: JudgeWindow, index: number): string {
  const end = window.endSeconds === null ? 'end' : clockTime(window.endSeconds);
  return `[${index + 1}] ${clockTime(window.startSeconds)}-${end}: ${window.text}`;
}

export function judgeState(profile: LearnerProfile, video: VideoToJudge): JevState {
  const about = video.summary
    ? { summary: video.summary, ...(video.keyPoints.length > 0 ? { key_points: video.keyPoints } : {}) }
    : { description: (video.description ?? '').slice(0, 2_000) || '(none)' };
  return {
    learner: learnerState(profile),
    video: {
      title: video.title,
      ...(video.channel ? { channel: video.channel } : {}),
      ...length(video.durationSeconds),
      ...about,
      [video.from === 'transcript' ? 'transcript_windows' : 'chapters']: video.windows.map(windowLine),
    },
  };
}

// ---------------------------------------------------------------------------
// Your filings, as a rule on top

const STOPWORDS = new Set(
  'about after again also another being between could does doing every from have here into just like made make more most much only other over really same should some than that their them then there these they thing things this those through under very what when where which while will with would your youre video videos episode part full guide how why'.split(
    ' ',
  ),
);

function words(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((word) => word.length >= 4 && !STOPWORDS.has(word)),
  );
}

function sameChannel(a: string | null, b: string | null): boolean {
  const tidy = (channel: string | null) => (channel ?? '').trim().toLowerCase();
  return tidy(a) !== '' && tidy(a) === tidy(b);
}

/** Titles on one topic share this many words that carry meaning. */
const TOPIC_WORDS = 2;

/**
 * The newest video you filed against the judge that shares this one's
 * channel or topic, or null. Filing a video where the judge had put it too
 * is not an override and does not count. A topic match is two or more
 * title words that carry meaning in common.
 */
export function overrideFor(video: { title: string; channel: string | null }, filed: readonly FiledVideo[] | undefined): FiledVideo | null {
  const mine = words(video.title);
  for (const filing of filed ?? []) {
    if (filing.judge === filing.you) continue;
    if (sameChannel(filing.channel, video.channel)) return filing;
    let shared = 0;
    for (const word of words(filing.title)) if (mine.has(word)) shared += 1;
    if (shared >= TOPIC_WORDS) return filing;
  }
  return null;
}

// ---------------------------------------------------------------------------
// What is written when Jev settles a video

/** The line stored as the reason when Jev settled a skip or a card. */
export function jevLine(pass: 'screen' | 'judge', answer: Pick<JevChoiceAnswer, 'choice' | 'confidence'>): string {
  const sure = `${Math.round(answer.confidence * 100)}% sure`;
  if (pass === 'screen') return `Skipped from its title and description, ${sure}.`;
  if (answer.choice === 'card') return `Judged worth a few cards rather than a watch, ${sure}.`;
  if (answer.choice === 'watch') return `Judged worth watching, ${sure}.`;
  return `Judged not worth your time, ${sure}.`;
}
