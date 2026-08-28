import 'server-only';

import { safeFetch } from './ssrf';
import type { FetchedPosting } from './types';

/**
 * Tier 2: fetch the page and read what is there.
 *
 * schema.org/JobPosting JSON-LD first — many career pages emit it, and when
 * they do it gives title, location, employment type and description as
 * structured data for free. Falling back to a readability-ish extraction of the
 * densest text block, which is worse but usually still better than nothing.
 */

interface JobPostingLd {
  '@type'?: string | string[];
  title?: string;
  description?: string;
  jobLocation?: unknown;
  hiringOrganization?: { name?: string };
  identifier?: { value?: string } | string;
  baseSalary?: {
    currency?: string;
    value?: { minValue?: number; maxValue?: number; unitText?: string };
  };
}

function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<head[\s\S]*?<\/head>/gi, ' ')
      .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<\/(p|div|section|li|h[1-6]|tr)>/gi, '\n')
      .replace(/<li[^>]*>/gi, '• ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function locationName(value: unknown): string | null {
  if (!value) return null;
  const first = Array.isArray(value) ? value[0] : value;
  if (typeof first === 'string') return first;
  if (typeof first === 'object' && first !== null) {
    const address = (first as { address?: unknown }).address;
    if (typeof address === 'string') return address;
    if (typeof address === 'object' && address !== null) {
      const a = address as Record<string, unknown>;
      return (
        [a.addressLocality, a.addressRegion, a.addressCountry]
          .filter((part): part is string => typeof part === 'string')
          .join(', ') || null
      );
    }
  }
  return null;
}

/** Walk a JSON-LD payload, which may be a graph, an array, or a single node. */
function findJobPosting(node: unknown, depth = 0): JobPostingLd | null {
  if (depth > 6 || node === null || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const entry of node) {
      const found = findJobPosting(entry, depth + 1);
      if (found) return found;
    }
    return null;
  }
  const record = node as Record<string, unknown>;
  const type = record['@type'];
  const types = Array.isArray(type) ? type : [type];
  if (types.includes('JobPosting')) return record as JobPostingLd;
  for (const key of ['@graph', 'itemListElement', 'mainEntity']) {
    const found = findJobPosting(record[key], depth + 1);
    if (found) return found;
  }
  return null;
}

export function extractJsonLd(html: string): JobPostingLd | null {
  const blocks = html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  );
  for (const block of blocks) {
    try {
      const found = findJobPosting(JSON.parse(block[1].trim()));
      if (found) return found;
    } catch {
      // A malformed block is common and not worth failing the whole fetch over.
    }
  }
  return null;
}

function titleFromHtml(html: string): string | null {
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  if (og) return decodeEntities(og[1]).trim();
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return title ? decodeEntities(title[1]).trim() : null;
}

export async function fetchPosting(url: string): Promise<FetchedPosting> {
  const { status, body, url: finalUrl } = await safeFetch(url);
  if (status !== 200) throw new Error(`That page returned ${status}.`);

  const ld = extractJsonLd(body);
  if (ld?.title && ld.description) {
    const identifier =
      typeof ld.identifier === 'string' ? ld.identifier : ld.identifier?.value ?? null;
    return {
      vendor: 'other',
      title: ld.title,
      text: htmlToText(ld.description),
      url: finalUrl,
      location: locationName(ld.jobLocation),
      atsJobId: identifier,
      boardToken: null,
      questions: [],
    };
  }

  const text = htmlToText(body);
  if (text.length < 400) {
    throw new Error(
      'That page did not contain a readable job description. Paste the description instead.',
    );
  }

  return {
    vendor: 'other',
    title: titleFromHtml(body) ?? 'Untitled role',
    text,
    url: finalUrl,
    location: null,
    atsJobId: null,
    boardToken: null,
    questions: [],
  };
}
