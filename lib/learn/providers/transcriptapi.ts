import 'server-only';

import { z } from 'zod';
import type { TranscriptCue } from '@/lib/learn/catalogue/segment';

/**
 * TranscriptAPI, for the words spoken in a YouTube video.
 *
 * YouTube's own `captions.download` only serves videos the caller owns
 * (lib/learn/providers/youtube.ts), and the public caption endpoint every
 * open-source library reads is blocked from cloud addresses like Vercel's.
 * TranscriptAPI fetches from its own network and answers over plain HTTPS
 * with a bearer key, so the call works from a serverless function.
 *
 * It is billed at one credit per transcript returned. Every error, including
 * 404 (no captions), 402 (out of credits) and 429 (rate limited), is free.
 * The caller writes each call to `learn.transcript_calls`, and `credits` below
 * is what goes in that row.
 *
 * One fixed host that we chose, like the GitHub and Gmail integrations, so
 * this does not go through `fetchDocument`, whose address guard exists for
 * URLs a model or a stranger supplied.
 */

const API_BASE = 'https://transcriptapi.com/api/v2/';

/**
 * Long videos take longer: the docs say more than two hours can be slow.
 * Generous, because a timed-out call that TranscriptAPI completed anyway has
 * charged a credit for a transcript nobody received.
 */
const TIMEOUT_MS = 60_000;

/** What went into the ledger's `outcome` column. */
export type TranscriptOutcome =
  | 'fetched'
  | 'no-transcript'
  | 'out-of-credits'
  | 'rate-limited'
  | 'unauthorized'
  | 'error';

export type FetchedTranscript = {
  ok: true;
  status: 200;
  credits: 1;
  /** `en`, or `asr-en` for auto-generated captions. Null if not reported. */
  language: string | null;
  cues: TranscriptCue[];
};

export type TranscriptFailure = {
  ok: false;
  outcome: Exclude<TranscriptOutcome, 'fetched'>;
  /** The HTTP status, or 0 when nothing came back. */
  status: number;
  /** 1 only when a 200 arrived and could not be read; otherwise 0. */
  credits: 0 | 1;
  /** Worth trying again later: a rate limit, a timeout, a server error. */
  retryable: boolean;
  detail: string;
};

export type TranscriptResult = FetchedTranscript | TranscriptFailure;

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

export function isVideoId(value: string): boolean {
  return VIDEO_ID.test(value);
}

export function transcriptRequestUrl(videoId: string): string {
  const url = new URL('youtube/transcript', API_BASE);
  url.searchParams.set('video_url', videoId);
  url.searchParams.set('format', 'json');
  url.searchParams.set('include_timestamp', 'true');
  // Title and channel come from the YouTube Data API already.
  url.searchParams.set('send_metadata', 'false');
  return url.toString();
}

const TranscriptResponse = z.object({
  language: z.string().nullish(),
  transcript: z.array(
    z.object({
      text: z.string(),
      start: z.number(),
      duration: z.number().nullish(),
    }),
  ),
});

const ErrorResponse = z.object({ detail: z.unknown().optional() });

/**
 * A 200's body as cues.
 *
 * Each line arrives with a start and a duration, and `TranscriptCue` wants a
 * start and an end. Line breaks inside a caption are where the caption wrapped
 * on screen, not where a sentence ended, so they become spaces. Empty lines
 * are dropped, which is what lib/learn/catalogue/segment.ts would do anyway.
 */
export function parseTranscriptResponse(
  body: string,
): { ok: true; language: string | null; cues: TranscriptCue[] } | { ok: false; detail: string } {
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return { ok: false, detail: 'TranscriptAPI answered with something that is not JSON' };
  }

  const parsed = TranscriptResponse.safeParse(payload);
  if (!parsed.success) return { ok: false, detail: 'TranscriptAPI answered in an unexpected shape' };

  const cues: TranscriptCue[] = [];
  for (const line of parsed.data.transcript) {
    const text = line.text.replace(/\s+/g, ' ').trim();
    if (!text || !Number.isFinite(line.start) || line.start < 0) continue;
    const duration = line.duration ?? null;
    cues.push({
      startSeconds: line.start,
      endSeconds: duration !== null && duration > 0 ? line.start + duration : null,
      text,
    });
  }

  return { ok: true, language: parsed.data.language ?? null, cues };
}

function errorDetail(body: string): string | null {
  try {
    const parsed = ErrorResponse.safeParse(JSON.parse(body));
    if (parsed.success && typeof parsed.data.detail === 'string') return parsed.data.detail;
  } catch {
    // Not JSON; the status alone has to do.
  }
  return null;
}

/**
 * A non-200 status as a ledger outcome, following the table in TranscriptAPI's
 * error-handling docs.
 */
export function failureFromStatus(status: number, body: string): TranscriptFailure {
  const said = errorDetail(body);
  const fail = (
    outcome: TranscriptFailure['outcome'],
    retryable: boolean,
    fallback: string,
  ): TranscriptFailure => ({ ok: false, outcome, status, credits: 0, retryable, detail: said ?? fallback });

  if (status === 404) return fail('no-transcript', false, 'the video has no captions, or does not exist');
  if (status === 402) return fail('out-of-credits', false, 'no TranscriptAPI credits left this month');
  if (status === 401) return fail('unauthorized', false, 'TRANSCRIPTAPI_KEY was refused');
  if (status === 429) return fail('rate-limited', true, 'rate limited');
  if (status === 408) return fail('rate-limited', true, 'TranscriptAPI timed out on its side');
  if (status === 400 || status === 422) return fail('error', false, `refused the request (${status})`);
  return fail('error', status >= 500, `answered ${status}`);
}

/**
 * Fetch one video's transcript. Never throws.
 */
export async function fetchTranscript(videoId: string): Promise<TranscriptResult> {
  if (!isVideoId(videoId)) {
    return { ok: false, outcome: 'error', status: 0, credits: 0, retryable: false, detail: `${videoId} is not a video id` };
  }

  const key = process.env.TRANSCRIPTAPI_KEY?.trim();
  if (!key) {
    return {
      ok: false,
      outcome: 'unauthorized',
      status: 0,
      credits: 0,
      retryable: false,
      detail: 'TRANSCRIPTAPI_KEY is not set',
    };
  }

  let response: Response;
  try {
    response = await fetch(transcriptRequestUrl(videoId), {
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError';
    return {
      ok: false,
      outcome: 'error',
      status: 0,
      credits: 0,
      retryable: true,
      detail: timedOut ? `no answer within ${TIMEOUT_MS / 1000} seconds` : 'could not reach TranscriptAPI',
    };
  }

  const body = await response.text().catch(() => '');
  if (response.status !== 200) return failureFromStatus(response.status, body);

  const parsed = parseTranscriptResponse(body);
  if (!parsed.ok) {
    // Charged: TranscriptAPI returned a transcript and counted it.
    return { ok: false, outcome: 'error', status: 200, credits: 1, retryable: false, detail: parsed.detail };
  }

  return { ok: true, status: 200, credits: 1, language: parsed.language, cues: parsed.cues };
}
