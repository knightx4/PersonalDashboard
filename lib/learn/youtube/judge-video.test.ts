import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import {
  chapterWindows,
  judgePrompt,
  judgeVideo,
  LONG_VIDEO_SECONDS,
  nextStep,
  profileText,
  readJudgeReply,
  readScreenReply,
  screenPrompt,
  transcriptWindows,
  type LearnerProfile,
  type VideoToScreen,
} from './judge-video';

const profile: LearnerProfile = {
  tracks: [{ name: 'Startup Finance / FP&A', note: null, frontier: ['A three-statement model links cash to profit.'], settled: 4 }],
  goals: [{ title: 'Run a half marathon', detail: 'Under two hours by spring.' }],
  ideas: [{ theme: 'Maginot Line', names: ['Why France fortified the east'] }],
};

const video = (videoId: string, title: string): VideoToScreen => ({
  videoId,
  title,
  channel: 'A channel',
  durationSeconds: 600,
  description: 'About it.',
  summary: null,
});

describe('profileText', () => {
  it('names every track, goal and theme so a reason can quote them', () => {
    const text = profileText(profile);
    expect(text).toContain('Track "Startup Finance / FP&A"');
    expect(text).toContain('Where they are now: A three-statement model links cash to profit.');
    expect(text).toContain('Goal "Run a half marathon"');
    expect(text).toContain('Theme "Maginot Line": Why France fortified the east');
  });

  it('says none rather than leaving a heading empty', () => {
    expect(profileText({ tracks: [], goals: [], ideas: [] }).match(/- none/g)).toHaveLength(3);
  });
});

describe('the screen', () => {
  const videos = [video('aaaaaaaaaaa', 'Cash flow in ten minutes'), video('bbbbbbbbbbb', 'Minecraft speedrun')];

  it('reads the summary instead of the description when there is one', () => {
    const prompt = screenPrompt(profile, [{ ...videos[0], summary: 'Cash is not profit.' }]);
    expect(prompt).toContain('Summary: Cash is not profit.');
    expect(prompt).not.toContain('Description:');
    expect(prompt).toContain('Length: 10:00');
  });

  it('matches the reply back by number and drops what it cannot place', () => {
    const screened = readScreenReply(
      {
        videos: [
          { number: 2, decision: 'skip', why: 'Touches none of your tracks, goals or ideas; a game run.' },
          { number: 1, decision: 'look', why: 'Serves your "Startup Finance / FP&A" track.' },
          { number: 3, decision: 'skip', why: 'Not a video that was sent.' },
          { number: 1, decision: 'skip', why: 'A second answer for the same video.' },
        ],
      },
      videos,
    );
    expect(screened).toEqual([
      { videoId: 'bbbbbbbbbbb', decision: 'skip', why: 'Touches none of your tracks, goals or ideas; a game run.' },
      { videoId: 'aaaaaaaaaaa', decision: 'look', why: 'Serves your "Startup Finance / FP&A" track.' },
    ]);
  });

  it('leaves a video with no reason unscreened, so the next run reads it again', () => {
    expect(readScreenReply({ videos: [{ number: 1, decision: 'skip', why: ' ' }] }, videos)).toEqual([]);
    expect(readScreenReply({ nonsense: true }, videos)).toEqual([]);
  });
});

describe('windows', () => {
  it('cuts a transcript into timed windows and runs the last to the end of the video', () => {
    const cues = Array.from({ length: 60 }, (_, index) => ({ startSeconds: index * 10, endSeconds: null, text: `Line ${index}.` }));
    const windows = transcriptWindows(cues, 610);
    expect(windows.length).toBeGreaterThan(1);
    expect(windows[0].startSeconds).toBe(0);
    expect(windows.at(-1)!.endSeconds).toBe(610);
    expect(windows[0].text).toContain('Line 0.');
  });

  it('runs each chapter to the next, and the video with none as one window', () => {
    expect(chapterWindows([{ startSeconds: 0, title: 'Intro' }, { startSeconds: 90, title: 'The model' }], 400)).toEqual([
      { startSeconds: 0, endSeconds: 90, text: 'Intro' },
      { startSeconds: 90, endSeconds: 400, text: 'The model' },
    ]);
    expect(chapterWindows([], 8000)).toEqual([{ startSeconds: 0, endSeconds: 8000, text: '(the whole video; it has no chapters)' }]);
  });

  it('numbers the windows with their times in the prompt', () => {
    const prompt = judgePrompt(profile, {
      title: 'Cash flow',
      channel: null,
      durationSeconds: 400,
      description: null,
      summary: 'Cash is not profit.',
      keyPoints: ['Depreciation is not cash.'],
      from: 'chapters',
      windows: chapterWindows([{ startSeconds: 0, title: 'Intro' }, { startSeconds: 90, title: 'The model' }], 400),
    });
    expect(prompt).toContain('CHAPTERS (there is no transcript to read):');
    expect(prompt).toContain('[2] 1:30-6:40: The model');
    expect(prompt).toContain('Key points: Depreciation is not cash.');
  });
});

describe('reading a verdict', () => {
  const windows = [
    { startSeconds: 0, endSeconds: 270, text: 'a' },
    { startSeconds: 240, endSeconds: 510, text: 'b' },
    { startSeconds: 480, endSeconds: null, text: 'c' },
  ];

  it('turns a watch stretch into its start and end minute, keeping the windows it drew on', () => {
    const judged = readJudgeReply(
      {
        verdict: 'watch',
        why: 'Serves your "Startup Finance / FP&A" track: builds the model live.',
        best_from: 2,
        best_to: 3,
        windows: [
          { window: 3, point: 'Links the balance sheet.' },
          { window: 2, point: 'Builds the income statement.' },
          { window: 1, point: 'Outside the stretch.' },
        ],
      },
      windows,
      900,
    );
    expect(judged).toEqual({
      outcome: 'judged',
      verdict: 'watch',
      why: 'Serves your "Startup Finance / FP&A" track: builds the model live.',
      bestStartSeconds: 240,
      bestEndSeconds: 900,
      stretches: [
        { startSeconds: 240, endSeconds: 510, point: 'Builds the income statement.' },
        { startSeconds: 480, endSeconds: 900, point: 'Links the balance sheet.' },
      ],
    });
  });

  it('refuses a watch verdict with no stretch rather than storing one with no minute', () => {
    expect(readJudgeReply({ verdict: 'watch', why: 'Serves your goal.', best_from: 9 }, windows, 900).outcome).toBe('failed');
  });

  it('keeps the card windows for #1067 and refuses a card verdict with none', () => {
    const judged = readJudgeReply(
      { verdict: 'card', why: 'Serves your "Maginot Line" theme.', windows: [{ window: 1, point: 'The line ended at Belgium.' }] },
      windows,
      900,
    );
    expect(judged).toMatchObject({ verdict: 'card', bestStartSeconds: null, stretches: [{ startSeconds: 0, endSeconds: 270, point: 'The line ended at Belgium.' }] });
    expect(readJudgeReply({ verdict: 'card', why: 'Serves it.', windows: [] }, windows, 900).outcome).toBe('failed');
  });

  it('stores a skip with no stretch', () => {
    expect(readJudgeReply({ verdict: 'skip', why: 'Touches none of them.', windows: [{ window: 1, point: 'x' }] }, windows, 900)).toMatchObject({
      verdict: 'skip',
      stretches: [],
      bestStartSeconds: null,
    });
  });
});

describe('judgeVideo', () => {
  it('makes one Haiku call and reports what it cost', async () => {
    const create = vi.fn().mockResolvedValue({
      content: [{ type: 'tool_use', name: 'report_verdict', input: { verdict: 'skip', why: 'Touches none of them.' } }],
      stop_reason: 'tool_use',
      usage: { input_tokens: 1200, output_tokens: 60 },
    });
    const onSpend = vi.fn();
    const judged = await judgeVideo({
      profile,
      video: { title: 't', channel: null, durationSeconds: 60, description: null, summary: null, keyPoints: [], from: 'chapters', windows: chapterWindows([], 60) },
      anthropicApiKey: 'k',
      client: { messages: { create } } as unknown as Anthropic,
      onSpend,
    });
    expect(judged.outcome).toBe('judged');
    expect(create.mock.calls[0][0].model).toBe('claude-haiku-4-5');
    expect(onSpend).toHaveBeenCalledTimes(1);
  });
});

describe('nextStep', () => {
  it('asks for a transcript nobody has asked for, and waits while it is queued', () => {
    expect(nextStep(600, null, 5)).toBe('queue');
    expect(nextStep(600, { state: 'queued', attempts: 0 }, 5)).toBe('wait');
    expect(nextStep(600, { state: 'failed', attempts: 2 }, 5)).toBe('wait');
  });

  it('judges from the transcript once it is stored', () => {
    expect(nextStep(600, { state: 'fetched', attempts: 0 }, 5)).toBe('transcript');
  });

  it('judges a long video, or one with no captions, from its chapters without asking for a transcript', () => {
    expect(nextStep(LONG_VIDEO_SECONDS + 1, null, 5)).toBe('chapters');
    expect(nextStep(LONG_VIDEO_SECONDS + 1, { state: 'fetched', attempts: 0 }, 5)).toBe('chapters');
    expect(nextStep(600, { state: 'none', attempts: 0 }, 5)).toBe('chapters');
    expect(nextStep(600, { state: 'failed', attempts: 5 }, 5)).toBe('chapters');
  });
});
