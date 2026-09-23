import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import type { SpendReport } from '@/lib/core/spend/pricing';
import { usageFrom } from '@/lib/core/spend/pricing';
import { recordSpend } from '@/lib/core/spend/record';
import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import { forceTool } from '@/lib/learn/graph/tool-call';
import type { NewsSupabaseClient } from '@/lib/news/db/schema-name';
import { readStories, type NewsStory } from '@/lib/news/issues/stories';

/**
 * A newsletter's summary and stories, written by Haiku from the body already
 * stored (plan #786).
 *
 * One call per issue. Nothing is fetched from the sender: the model reads the
 * body already stored, and links in it are kept but never followed. A
 * newsletter that is one essay gets its summary and an empty story list.
 *
 * Links (plan #803). Each link in the text sent is replaced by a marker such as
 * `[link 3]`, and the model reports the number beside a story rather than the
 * address. The number is looked up in the list built here, so the stored link
 * is the address the email itself carried; a tracked address runs to hundreds
 * of characters, and one retyped by the model could break.
 *
 * `digestIssue` saves the outcome on the row, as the columns added by
 * supabase/migrations-news/0005_issues_digest.sql expect: a summary and its
 * stories on success, or `digest_error` on failure, with `digested_at` set
 * either way. A failed digest leaves the issue readable as it was.
 *
 * The line (plan #824). Alongside the summary Haiku writes one line of about
 * ninety characters for the newsletter list, stored as `summary_line` by
 * 0006_issues_summary_line.sql. A reply that leaves it out still stores the
 * summary, with the line null.
 */

export const DIGEST_MODEL = 'claude-haiku-4-5';

/** The name this call has in core.model_spend. Stable: renaming it splits the history. */
export const DIGEST_OPERATION = 'digest-issue';

const TOOL_NAME = 'report_digest';

/**
 * Longest body sent, in characters. The stored text bodies run to about
 * eighteen thousand, so this only bites on an HTML-only issue that strips to
 * something unusually long.
 */
const MAX_BODY_CHARS = 60_000;

/** Enough for a summary and a roundup of about thirty stories. */
const MAX_TOKENS = 4_000;

/** Longest error kept on the row, so a provider's error page is not stored whole. */
const MAX_ERROR_CHARS = 500;

/** The length the line is asked for, and the most that is stored. */
export const LINE_CHARS = 90;

const SYSTEM = `You summarise one email newsletter so its reader can see what
is in it without reading the email.

LINE. One line of at most ${LINE_CHARS} characters saying what this issue covers,
for a list of newsletters. Name the main subjects, not the newsletter.

SUMMARY. Two or three plain sentences on what this issue covers as a whole.
Say what it says, not that it is a newsletter.

STORIES. List each separate story, article or item the issue covers, in the
order it appears. For each, give a short headline in your own words and two
sentences on what it says. Use the newsletter's own facts and do not add any.

LEAVE OUT sponsor messages and advertisements, housekeeping such as "view in
browser", subscription and unsubscribe text, social links, and the sign-off.

LINKS. Each link in the email appears as a marker such as [link 3], placed
after the words it was attached to. For each story, give the number of the
link to that story's own article, usually the one on or next to its headline
or its "read more". Leave the number out when the story has no such link.
Never give a link to a sponsor, a share or subscribe button, or the
newsletter's own site.

ONE ESSAY. When the issue is a single article or essay rather than a set of
items, the summary covers it and the story list is empty. Do not cut one essay
into stories by its sections.`;

const TOOL = {
  name: TOOL_NAME,
  description: 'Report the summary of this newsletter issue and the stories it covers.',
  input_schema: {
    type: 'object' as const,
    properties: {
      line: {
        type: 'string',
        description: `What this issue covers, in one line of at most ${LINE_CHARS} characters.`,
      },
      summary: { type: 'string' },
      stories: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            headline: { type: 'string' },
            summary: { type: 'string' },
            link: {
              type: 'integer',
              description:
                "The N of the [link N] marker for this story's own article. Omit when there is none.",
            },
          },
          required: ['headline', 'summary'],
        },
      },
    },
    required: ['line', 'summary', 'stories'],
  },
};

/** What is read from a stored issue. */
export type DigestSource = {
  subject: string | null;
  textBody: string | null;
  htmlBody: string | null;
};

/** `line` is null when the reply left it out. */
export type Digest = { line: string | null; summary: string; stories: NewsStory[] };

/** What became of one issue. */
export type DigestOutcome =
  | ({ status: 'digested' } & Digest)
  | { status: 'failed'; error: string }
  | { status: 'missing' };

/** Characters a newsletter pads its preview text with, which carry nothing. */
const INVISIBLE = /[\u00AD\u034F\u200B-\u200D\u2060\uFEFF]/g;

/**
 * Hands out the `[link N]` markers, one number per distinct address, and keeps
 * the addresses in order so number N is `links[N - 1]`.
 */
class LinkNumbers {
  readonly links: string[] = [];

  marker(address: string): string {
    const url = address.trim();
    if (!/^https?:\/\//i.test(url)) return '';
    let index = this.links.indexOf(url);
    if (index === -1) index = this.links.push(url) - 1;
    return ` [link ${index + 1}] `;
  }
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/gi, '&');
}

/**
 * The line as it is stored: one line, spaces collapsed, and cut at a word
 * boundary with an ellipsis when it runs past LINE_CHARS. Null when there is
 * no text.
 */
export function readLine(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const line = value.replace(/\s+/g, ' ').trim();
  if (!line) return null;
  if (line.length <= LINE_CHARS) return line;
  const cut = line.slice(0, LINE_CHARS - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > LINE_CHARS / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:.-]+$/, '')}…`;
}

const ANCHOR = /<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi;
const HREF = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;

/**
 * HTML to readable text. Given `numbers`, each http(s) link is kept as a
 * `[link N]` marker after its words; without it, links are dropped with the
 * tags.
 */
export function htmlToText(html: string, numbers?: LinkNumbers): string {
  const cleared = html
    .replace(/<head[\s\S]*?<\/head>/gi, ' ')
    .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, ' ');
  const linked = numbers
    ? cleared.replace(ANCHOR, (_, attributes: string, inner: string) => {
        const href = HREF.exec(attributes);
        const address = href ? decodeEntities(href[1] ?? href[2] ?? href[3] ?? '') : '';
        return `${inner}${numbers.marker(address)}`;
      })
    : cleared;
  return decodeEntities(
    linked
      .replace(/<\/(p|div|section|li|h[1-6]|tr|table)>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  );
}

/**
 * A plain-text body with each address it carries replaced by a marker. Senders
 * write them as `(https://…)`, `[ https://… ]`, `<https://…>` or bare, and the
 * brackets go with the address.
 */
function numberTextLinks(text: string, numbers: LinkNumbers): string {
  return text.replace(
    /[[(<]\s*(https?:\/\/[^\s<>[\]()]+)\s*[\])>]|(https?:\/\/[^\s<>[\]()]+)/gi,
    (_, bracketed: string | undefined, bare: string | undefined) =>
      numbers.marker(bracketed ?? bare ?? ''),
  );
}

/** The text Haiku reads, and the addresses its `[link N]` markers stand for. */
export type BodyText = { text: string; links: string[] };

/**
 * The text Haiku reads.
 *
 * The HTML, stripped, when it carries any http(s) link: its links are what
 * clicking in the email opens, and some senders' text bodies leave the story
 * links out (Morning Brew's carries two addresses where its HTML carries
 * about ninety). Otherwise the text body, with the addresses it writes out
 * numbered, and the stripped HTML only when there is no text body.
 * Padding characters and runs of blank space are collapsed.
 */
export function bodyText(source: DigestSource): BodyText {
  const numbers = new LinkNumbers();
  const html = source.htmlBody ?? '';
  const htmlText = htmlToText(html, numbers);
  let raw: string;
  if (numbers.links.length > 0) raw = htmlText;
  else if (source.textBody?.trim()) {
    raw = numberTextLinks(source.textBody, numbers);
  } else raw = htmlText;

  const text = raw
    .replace(/\r\n?/g, '\n')
    .replace(INVISIBLE, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_BODY_CHARS);
  return { text, links: numbers.links };
}

/**
 * The model's report as something that can be stored, or why it cannot.
 *
 * Each story's link number is looked up in `links`, the addresses behind the
 * `[link N]` markers; a number that is not a whole number from 1 to the
 * number of links is dropped, and the story kept without a link. Stories then
 * go through `readStories`, the same reading the page applies, so a story
 * without a headline or summary is dropped here rather than stored.
 */
export function readDigest(input: unknown, links: readonly string[] = []): Digest | string {
  if (!input || typeof input !== 'object') return 'The model returned no digest.';
  const { line, summary, stories } = input as Record<string, unknown>;
  if (typeof summary !== 'string' || !summary.trim()) return 'The model returned no summary.';
  const linked = Array.isArray(stories)
    ? stories.map((story: unknown) => {
        if (!story || typeof story !== 'object') return story;
        const { link, ...rest } = story as Record<string, unknown>;
        const n = typeof link === 'string' && /^\d+$/.test(link.trim()) ? Number(link) : link;
        const address =
          typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= links.length
            ? links[n - 1]
            : undefined;
        return address ? { ...rest, link: address } : rest;
      })
    : stories;
  return { line: readLine(line), summary: summary.trim(), stories: readStories(linked) };
}

/**
 * One call to Haiku for one issue. Throws with a sentence a person can read
 * when the call fails or reports nothing usable. Spend is reported to
 * `onSpend` whenever a reply came back, usable or not.
 */
export async function writeDigest(
  source: DigestSource,
  options: { client: Pick<Anthropic, 'messages'>; onSpend?: (report: SpendReport) => void },
): Promise<Digest> {
  const { text, links } = bodyText(source);
  if (!text) throw new Error('The issue has no text to summarise.');

  const response = await options.client.messages.create({
    model: DIGEST_MODEL,
    max_tokens: MAX_TOKENS,
    system: SYSTEM,
    tools: [TOOL],
    tool_choice: forceTool(TOOL_NAME),
    messages: [
      {
        role: 'user',
        content: [`Subject: ${source.subject ?? '(none)'}`, '', text].join('\n'),
      },
    ],
  });

  options.onSpend?.({ model: DIGEST_MODEL, usage: usageFrom(response.usage) });

  if (response.stop_reason === 'max_tokens') {
    throw new Error('The reply was cut off before it finished.');
  }
  const block = response.content.find(
    (part) => part.type === 'tool_use' && part.name === TOOL_NAME,
  );
  if (!block || block.type !== 'tool_use') {
    throw new Error(`The model did not report a digest (stopped: ${response.stop_reason ?? 'unknown'}).`);
  }
  const digest = readDigest(block.input, links);
  if (typeof digest === 'string') throw new Error(digest);
  return digest;
}

function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.trim().slice(0, MAX_ERROR_CHARS) || 'The digest failed for an unknown reason.';
}

/**
 * Digest one stored issue and save the outcome on it.
 *
 * `news` may be the service-role client, so every query names the account.
 * `spend` is a client bound to the core schema; the call's cost is written to
 * core.model_spend under module 'news', operation 'digest-issue', whether the
 * reply was usable or not. Throws only when the row itself cannot be read or
 * written; a failed model call is saved as `digest_error` and returned.
 */
export async function digestIssue(input: {
  news: NewsSupabaseClient;
  spend: Pick<CoreSupabaseClient, 'from'>;
  userId: string;
  issueId: string;
  anthropicApiKey: string;
  client?: Pick<Anthropic, 'messages'>;
}): Promise<DigestOutcome> {
  const { data, error } = await input.news
    .from('issues')
    .select('subject, text_body, html_body')
    .eq('id', input.issueId)
    .eq('user_id', input.userId)
    .maybeSingle();
  if (error) throw new Error(`news: reading the issue to summarise failed (${error.message})`);
  if (!data) return { status: 'missing' };

  const reports: SpendReport[] = [];

  let outcome: Exclude<DigestOutcome, { status: 'missing' }>;
  try {
    const client = input.client ?? new Anthropic({ apiKey: input.anthropicApiKey });
    const digest = await writeDigest(
      {
        subject: data.subject as string | null,
        textBody: data.text_body as string | null,
        htmlBody: data.html_body as string | null,
      },
      { client, onSpend: (report) => reports.push(report) },
    );
    outcome = { status: 'digested', ...digest };
  } catch (failure) {
    outcome = { status: 'failed', error: errorText(failure) };
  }

  const row =
    outcome.status === 'digested'
      ? {
          summary: outcome.summary,
          summary_line: outcome.line,
          stories: outcome.stories,
          digest_error: null,
        }
      : { summary: null, summary_line: null, stories: null, digest_error: outcome.error };

  const saved = await input.news
    .from('issues')
    .update({ ...row, digested_at: new Date().toISOString() })
    .eq('id', input.issueId)
    .eq('user_id', input.userId);

  for (const report of reports) {
    await recordSpend(input.spend, input.userId, {
      module: 'news',
      operation: DIGEST_OPERATION,
      model: report.model,
      usage: report.usage,
    });
  }

  if (saved.error) throw new Error(`news: saving the summary failed (${saved.error.message})`);
  return outcome;
}
