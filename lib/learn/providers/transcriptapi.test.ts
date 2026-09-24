import { describe, expect, it } from 'vitest';

import {
  failureFromStatus,
  isVideoId,
  parseTranscriptResponse,
  transcriptRequestUrl,
} from '@/lib/learn/providers/transcriptapi';

/**
 * What TranscriptAPI answers, and what the ledger records for it.
 *
 * The 200 body below is the shape the service returned for MIT 18.06 lecture 1
 * (ZK3O402wf1c), cut to three lines. The error bodies follow its documented
 * `{ detail, code }` format.
 */

const LECTURE_ONE = JSON.stringify({
  video_id: 'ZK3O402wf1c',
  language: 'en',
  transcript: [
    { text: "Hi. This is the first lecture\nin MIT's course 18.06,", start: 8, duration: 5.519 },
    { text: "linear algebra, and\nI'm Gilbert Strang.", start: 14, duration: 5.2 },
    { text: '   ', start: 19, duration: 1 },
    { text: 'The text for the\ncourse is this book.', start: 19.4 },
  ],
});

describe('transcriptRequestUrl', () => {
  it('asks for timed JSON and no metadata', () => {
    const url = new URL(transcriptRequestUrl('ZK3O402wf1c'));
    expect(url.origin + url.pathname).toBe('https://transcriptapi.com/api/v2/youtube/transcript');
    expect(url.searchParams.get('video_url')).toBe('ZK3O402wf1c');
    expect(url.searchParams.get('format')).toBe('json');
    expect(url.searchParams.get('include_timestamp')).toBe('true');
    expect(url.searchParams.get('send_metadata')).toBe('false');
  });
});

describe('isVideoId', () => {
  it('takes an eleven-character id and nothing else', () => {
    expect(isVideoId('ZK3O402wf1c')).toBe(true);
    expect(isVideoId('dQw4w9WgXc_')).toBe(true);
    expect(isVideoId('https://youtu.be/ZK3O402wf1c')).toBe(false);
    expect(isVideoId('short')).toBe(false);
  });
});

describe('parseTranscriptResponse', () => {
  it('turns start and duration into start and end, and caption wraps into spaces', () => {
    const parsed = parseTranscriptResponse(LECTURE_ONE);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(parsed.language).toBe('en');
    expect(parsed.cues[0]).toEqual({
      startSeconds: 8,
      endSeconds: 13.519,
      text: "Hi. This is the first lecture in MIT's course 18.06,",
    });
  });

  it('drops blank lines and leaves the end open where no duration came', () => {
    const parsed = parseTranscriptResponse(LECTURE_ONE);
    if (!parsed.ok) throw new Error('expected a transcript');

    expect(parsed.cues).toHaveLength(3);
    expect(parsed.cues[2]).toEqual({ startSeconds: 19.4, endSeconds: null, text: 'The text for the course is this book.' });
  });

  it('refuses a body it cannot read rather than guessing', () => {
    expect(parseTranscriptResponse('<html>').ok).toBe(false);
    expect(parseTranscriptResponse(JSON.stringify({ transcript: 'no' })).ok).toBe(false);
  });
});

describe('failureFromStatus', () => {
  it('charges nothing for any error', () => {
    for (const status of [400, 401, 402, 404, 408, 422, 429, 500, 503]) {
      expect(failureFromStatus(status, '').credits).toBe(0);
    }
  });

  it('names the outcomes the ledger records', () => {
    expect(failureFromStatus(404, '').outcome).toBe('no-transcript');
    expect(failureFromStatus(402, '').outcome).toBe('out-of-credits');
    expect(failureFromStatus(401, '').outcome).toBe('unauthorized');
    expect(failureFromStatus(429, '').outcome).toBe('rate-limited');
    expect(failureFromStatus(408, '').outcome).toBe('rate-limited');
    expect(failureFromStatus(500, '').outcome).toBe('error');
  });

  it('retries only what the docs say is temporary', () => {
    expect(failureFromStatus(429, '').retryable).toBe(true);
    expect(failureFromStatus(408, '').retryable).toBe(true);
    expect(failureFromStatus(503, '').retryable).toBe(true);
    expect(failureFromStatus(404, '').retryable).toBe(false);
    expect(failureFromStatus(402, '').retryable).toBe(false);
    expect(failureFromStatus(422, '').retryable).toBe(false);
  });

  it("keeps the service's own words when it gives them", () => {
    const body = JSON.stringify({ detail: 'No transcript available for the requested languages: en', code: 'x' });
    expect(failureFromStatus(404, body).detail).toBe('No transcript available for the requested languages: en');
  });
});
