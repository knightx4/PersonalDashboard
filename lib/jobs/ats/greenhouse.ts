import 'server-only';

import { safeFetch } from './ssrf';
import type { FetchedPosting, FetchedQuestion } from './types';

/**
 * Greenhouse. The good case, and the only vendor that genuinely serves the
 * application questions: `?questions=true` returns the full typed field list
 * with required flags, which is exactly what the question bank wants.
 */

const BASE = 'https://boards-api.greenhouse.io/v1/boards';

interface GreenhouseJob {
  id?: number;
  title?: string;
  content?: string;
  absolute_url?: string;
  location?: { name?: string };
  updated_at?: string;
  questions?: Array<{
    label?: string;
    required?: boolean;
    fields?: Array<{ name?: string; type?: string }>;
  }>;
  metadata?: Array<{ name?: string; value?: unknown }>;
}

/** Greenhouse returns the body as escaped HTML inside JSON. */
function htmlToText(html: string): string {
  return html
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function fetchPosting(
  boardToken: string,
  jobId: string,
): Promise<FetchedPosting> {
  const { status, body } = await safeFetch(
    `${BASE}/${encodeURIComponent(boardToken)}/jobs/${encodeURIComponent(jobId)}?questions=true`,
  );

  if (status !== 200) {
    throw new Error(`Greenhouse returned ${status} for that posting.`);
  }

  const job = JSON.parse(body) as GreenhouseJob;
  if (!job.title) throw new Error('Greenhouse returned no posting.');

  return {
    vendor: 'greenhouse',
    title: job.title,
    text: job.content ? htmlToText(job.content) : '',
    url: job.absolute_url ?? null,
    location: job.location?.name ?? null,
    atsJobId: job.id != null ? String(job.id) : jobId,
    boardToken,
    questions: (job.questions ?? []).map(toQuestion).filter(Boolean) as FetchedQuestion[],
  };
}

function toQuestion(raw: NonNullable<GreenhouseJob['questions']>[number]): FetchedQuestion | null {
  const label = raw.label?.trim();
  if (!label) return null;
  const field = raw.fields?.[0];
  return {
    text: label,
    required: Boolean(raw.required),
    inputType: field?.type ?? null,
  };
}
