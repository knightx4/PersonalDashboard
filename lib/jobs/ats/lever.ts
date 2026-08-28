import 'server-only';

import { safeFetch } from './ssrf';
import type { FetchedPosting } from './types';

/**
 * Lever's public postings feed. Serves the description reliably; it does not
 * serve the application form's questions, so those come from the bookmarklet.
 */

interface LeverPosting {
  id?: string;
  text?: string;
  hostedUrl?: string;
  descriptionPlain?: string;
  description?: string;
  lists?: Array<{ text?: string; content?: string }>;
  additionalPlain?: string;
  categories?: { location?: string; commitment?: string; team?: string };
}

function plainText(posting: LeverPosting): string {
  const parts = [posting.descriptionPlain ?? stripHtml(posting.description ?? '')];
  for (const list of posting.lists ?? []) {
    if (list.text) parts.push(`\n${list.text}`);
    if (list.content) parts.push(stripHtml(list.content));
  }
  if (posting.additionalPlain) parts.push(posting.additionalPlain);
  return parts.filter(Boolean).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function stripHtml(html: string): string {
  return html
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .trim();
}

export async function fetchPosting(
  boardToken: string,
  jobId: string | null,
): Promise<FetchedPosting> {
  const target = jobId
    ? `https://api.lever.co/v0/postings/${encodeURIComponent(boardToken)}/${encodeURIComponent(jobId)}?mode=json`
    : `https://api.lever.co/v0/postings/${encodeURIComponent(boardToken)}?mode=json`;

  const { status, body } = await safeFetch(target);
  if (status !== 200) throw new Error(`Lever returned ${status} for that posting.`);

  const parsed = JSON.parse(body) as LeverPosting | LeverPosting[];
  const posting = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!posting?.text) throw new Error('Lever returned no posting.');

  return {
    vendor: 'lever',
    title: posting.text,
    text: plainText(posting),
    url: posting.hostedUrl ?? null,
    location: posting.categories?.location ?? null,
    atsJobId: posting.id ?? jobId,
    boardToken,
    // Lever does not expose the application form publicly. The bookmarklet does.
    questions: [],
  };
}
