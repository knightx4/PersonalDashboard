import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import type { SpendReport } from '@/lib/core/spend/pricing';
import { usageFrom } from '@/lib/core/spend/pricing';
import { recordSpend } from '@/lib/core/spend/record';
import type { NewsOperation } from '@/lib/core/spend/operations';
import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import { forceTool } from '@/lib/learn/graph/tool-call';
import type { NewsSupabaseClient } from '@/lib/news/db/schema-name';
import { readStories, type NewsStory } from '@/lib/news/issues/stories';
import { FALLBACK_TOPIC, NEWS_TOPICS, readTopic } from '@/lib/news/issues/topics';

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
 *
 * A redo. An issue that already has a summary can be digested again, which is
 * how the issues summarised before the line existed get one. A redo that fails
 * keeps the summary it had and only moves `digested_at`, since the row cannot
 * hold a summary and an error at once and the old summary is still worth
 * reading. A redo that succeeds deletes the issue's rows in `story_passes`
 * (plan #849, 0007_story_passes.sql) and `story_groups` (plan #864,
 * 0010_story_groups.sql): both name a story by its position in the array, and
 * the new array puts different stories at those positions.
 *
 * Pictures and the story's own text. Each picture in the HTML is replaced by
 * an `[image N]` marker the same way links are, and the model gives the
 * number of the one printed with each story; the stored address is the
 * email's own. The model also copies each story's text out of the email, so
 * the page can show the whole story under its summary. Both live on the story
 * inside the `stories` jsonb, so neither needed a column.
 *
 * Topics (plan #859). The model also picks one of NEWS_TOPICS for each story,
 * kept on the story in the same jsonb. A story it gives no topic, or one not
 * on the list, is stored as Other, so every story digested from here on has
 * one.
 */

export const DIGEST_MODEL = 'claude-haiku-4-5';

/** The name this call has in core.model_spend. Stable: renaming it splits the history. */
export const DIGEST_OPERATION: NewsOperation = 'digest-issue';

const TOOL_NAME = 'report_digest';

/**
 * Longest body sent, in characters. The stored text bodies run to about
 * eighteen thousand, so this only bites on an HTML-only issue that strips to
 * something unusually long.
 */
const MAX_BODY_CHARS = 60_000;

/**
 * Enough for a summary and about thirty stories with their text copied out.
 * A long issue's copied text runs to a few thousand tokens; Haiku allows far
 * more than this, and the cap is only there to end a reply that runs away.
 */
const MAX_TOKENS = 16_000;

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

ROUNDUPS. Many issues have a section of short items under one heading, such as
"Tour de headlines", "Quick hits" or "What else is brewing". Each item in such
a section is a story of its own: list every one, not the section as a whole.
An issue that opens with a list of what it covers is naming its main stories
only; the stories are everything in the body, not just that list.

TEXT. For each story, copy its text from the email word for word: every
paragraph of it, in order, with a blank line between paragraphs. For a short
roundup item that is its one paragraph. Leave out the headline, the [link N]
and [image N] markers, photo credits, and any sponsor message that sits inside
the story.

LEAVE OUT sponsor messages and advertisements, housekeeping such as "view in
browser", subscription and unsubscribe text, social links, and the sign-off.

LINKS. Each link in the email appears as a marker such as [link 3], placed
after the words it was attached to. For each story, give the number of the
link to that story's own article, usually the one on or next to its headline
or its "read more". Leave the number out when the story has no such link.
Never give a link to a sponsor, a share or subscribe button, or the
newsletter's own site.

PICTURES. Each picture in the email appears as a marker such as [image 4],
where the picture sat. For each story, give the number of the picture printed
with it, usually just above or below its headline. Leave the number out when
the story has none. Never give a logo, an icon, an advertisement, or a picture
that belongs to a different story.

TOPIC. For each story, pick the one topic from this list that fits it best:
${NEWS_TOPICS.join(', ')}. Judge by what the story is about, not by what the
newsletter usually covers. Use Other only when none of the rest fits.

LOCAL. The message may name the reader's local area. A story mainly about that
place, such as its city government, mayor, transit, schools, neighbourhoods or
events there, is Local, even where another topic would also fit. When no local
area is named, never pick Local.

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
            image: {
              type: 'integer',
              description:
                'The N of the [image N] marker for the picture printed with this story. Omit when there is none.',
            },
            text: {
              type: 'string',
              description:
                "The story's own text from the email, word for word, paragraphs separated by a blank line.",
            },
            topic: {
              type: 'string',
              enum: [...NEWS_TOPICS],
              description: 'The one topic from the list that fits this story best.',
            },
          },
          required: ['headline', 'summary', 'topic'],
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
 * Hands out one kind of marker, `[link N]` or `[image N]`, one number per
 * distinct address, and keeps the addresses in order so number N is
 * `addresses[N - 1]`.
 */
class Numbers {
  readonly addresses: string[] = [];

  constructor(private readonly kind: 'link' | 'image') {}

  marker(address: string): string {
    const url = address.trim();
    if (!/^https?:\/\//i.test(url)) return '';
    let index = this.addresses.indexOf(url);
    if (index === -1) index = this.addresses.push(url) - 1;
    return ` [${this.kind} ${index + 1}] `;
  }
}

/** The numbers handed out while reading one email's HTML. */
type Markers = { links: Numbers; images: Numbers };

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
const IMG = /<img\b([^>]*)>/gi;

/** The value of one attribute in a tag's attribute text, or null. */
function attribute(attributes: string, name: string): string | null {
  const match = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(
    attributes,
  );
  return match ? (match[1] ?? match[2] ?? match[3] ?? '') : null;
}

/**
 * A picture too small to be a story's: a tracking pixel, a spacer, or an icon
 * such as a share button or a market arrow, going by the size the email gives
 * it. Fewer markers means less for the model to pick wrongly from. A picture
 * with no size given is kept.
 */
const ICON_PX = 48;

function isIcon(attributes: string): boolean {
  const small = (value: string | null) => {
    const match = value === null ? null : /^\s*(\d+)(px)?\s*$/i.exec(value);
    return match !== null && Number(match[1]) < ICON_PX;
  };
  if (small(attribute(attributes, 'width')) || small(attribute(attributes, 'height'))) return true;
  const style = attribute(attributes, 'style') ?? '';
  return [...style.matchAll(/(?:^|;)\s*(?:width|height)\s*:\s*(\d+)px/gi)].some(
    (match) => Number(match[1]) < ICON_PX,
  );
}

/**
 * HTML to readable text. Given `markers`, each http(s) link is kept as a
 * `[link N]` marker after its words and each picture as an `[image N]` marker
 * where it sat; without it, links and pictures are dropped with the tags.
 */
export function htmlToText(html: string, markers?: Markers): string {
  const cleared = html
    .replace(/<head[\s\S]*?<\/head>/gi, ' ')
    .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, ' ');
  // Pictures first, so one inside a link keeps its marker ahead of the link's.
  const pictured = markers
    ? cleared.replace(IMG, (_, attributes: string) => {
        if (isIcon(attributes)) return ' ';
        return markers.images.marker(decodeEntities(attribute(attributes, 'src') ?? ''));
      })
    : cleared;
  const linked = markers
    ? pictured.replace(ANCHOR, (_, attributes: string, inner: string) => {
        const href = HREF.exec(attributes);
        const address = href ? decodeEntities(href[1] ?? href[2] ?? href[3] ?? '') : '';
        return `${inner}${markers.links.marker(address)}`;
      })
    : pictured;
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
function numberTextLinks(text: string, numbers: Numbers): string {
  return text.replace(
    /[[(<]\s*(https?:\/\/[^\s<>[\]()]+)\s*[\])>]|(https?:\/\/[^\s<>[\]()]+)/gi,
    (_, bracketed: string | undefined, bare: string | undefined) =>
      numbers.marker(bracketed ?? bare ?? ''),
  );
}

/**
 * The text Haiku reads, and the addresses its `[link N]` and `[image N]`
 * markers stand for.
 */
export type BodyText = { text: string; links: string[]; images: string[] };

/**
 * The text Haiku reads.
 *
 * The HTML, stripped, when it carries any http(s) link: its links are what
 * clicking in the email opens, and some senders' text bodies leave the story
 * links out (Morning Brew's carries two addresses where its HTML carries
 * about ninety). Otherwise the text body, with the addresses it writes out
 * numbered, and the stripped HTML only when there is no text body.
 * Pictures are numbered only when the HTML is what is read, since a text body
 * has none. Padding characters and runs of blank space are collapsed.
 */
export function bodyText(source: DigestSource): BodyText {
  const markers: Markers = { links: new Numbers('link'), images: new Numbers('image') };
  const html = source.htmlBody ?? '';
  const htmlText = htmlToText(html, markers);
  let raw: string;
  let images = markers.images.addresses;
  if (markers.links.addresses.length > 0) raw = htmlText;
  else if (source.textBody?.trim()) {
    raw = numberTextLinks(source.textBody, markers.links);
    images = [];
  } else raw = htmlText;

  const text = raw
    .replace(/\r\n?/g, '\n')
    .replace(INVISIBLE, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_BODY_CHARS);
  return { text, links: markers.links.addresses, images };
}

/**
 * The address behind a marker number the model gave, or undefined when the
 * number is not a whole number from 1 to the count of addresses. A number
 * sent as text is read as the number.
 */
function lookUp(value: unknown, addresses: readonly string[]): string | undefined {
  const n = typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value) : value;
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= addresses.length
    ? addresses[n - 1]
    : undefined;
}

/** A story's copied text without the markers, if the model left any in. */
function withoutMarkers(text: unknown): unknown {
  if (typeof text !== 'string') return text;
  return text
    .replace(/ ?\[(link|image) \d+\] ?/g, ' ')
    .replace(/[ \t]+([,.;:!?])/g, '$1')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/[ \t]{2,}/g, ' ');
}

/**
 * The model's report as something that can be stored, or why it cannot.
 *
 * Each story's link number is looked up in `links` and its picture number in
 * `images`, the addresses behind the markers; a number that is not a whole
 * number from 1 to the count of addresses is dropped, and the story kept
 * without it. A topic not on NEWS_TOPICS, or none at all, becomes Other.
 * Stories then go through `readStories`, the same reading the page applies, so
 * a story without a headline or summary is dropped here rather than stored.
 */
export function readDigest(
  input: unknown,
  links: readonly string[] = [],
  images: readonly string[] = [],
): Digest | string {
  if (!input || typeof input !== 'object') return 'The model returned no digest.';
  const { line, summary, stories } = input as Record<string, unknown>;
  if (typeof summary !== 'string' || !summary.trim()) return 'The model returned no summary.';
  const linked = Array.isArray(stories)
    ? stories.map((story: unknown) => {
        if (!story || typeof story !== 'object') return story;
        const { link, image, text, topic, ...rest } = story as Record<string, unknown>;
        const out: Record<string, unknown> = {
          ...rest,
          text: withoutMarkers(text),
          topic: readTopic(topic) ?? FALLBACK_TOPIC,
        };
        const linkAddress = lookUp(link, links);
        if (linkAddress) out.link = linkAddress;
        const imageAddress = lookUp(image, images);
        if (imageAddress) out.image = imageAddress;
        return out;
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
  options: {
    client: Pick<Anthropic, 'messages'>;
    onSpend?: (report: SpendReport) => void;
    /** Where the reader lives, from news.preferences, for the Local topic. */
    localArea?: string | null;
  },
): Promise<Digest> {
  const { text, links, images } = bodyText(source);
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
        // The local area goes in the message rather than the system prompt,
        // so the prompt stays one fixed string for every reader.
        content: [
          ...(options.localArea ? [`Reader's local area: ${options.localArea}`] : []),
          `Subject: ${source.subject ?? '(none)'}`,
          '',
          text,
        ].join('\n'),
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
  const digest = readDigest(block.input, links, images);
  if (typeof digest === 'string') throw new Error(digest);
  // Local means the reader's own place, so with none named it cannot be right.
  if (!options.localArea) {
    for (const story of digest.stories) {
      if (story.topic === 'Local') story.topic = FALLBACK_TOPIC;
    }
  }
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
 * written; a failed model call is saved as `digest_error` and returned, unless
 * the issue already had a summary, which is then kept. A new summary over an
 * old one also clears the issue's story passes.
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
    .select('subject, text_body, html_body, summary')
    .eq('id', input.issueId)
    .eq('user_id', input.userId)
    .maybeSingle();
  if (error) throw new Error(`news: reading the issue to summarise failed (${error.message})`);
  if (!data) return { status: 'missing' };

  const reports: SpendReport[] = [];

  // Read before the call, and a failed read only costs the Local topic.
  const { data: preferences } = await input.news
    .from('preferences')
    .select('local_area')
    .eq('user_id', input.userId)
    .maybeSingle();
  const localArea = (preferences?.local_area as string | null | undefined) ?? null;

  let outcome: Exclude<DigestOutcome, { status: 'missing' }>;
  try {
    const client = input.client ?? new Anthropic({ apiKey: input.anthropicApiKey });
    const digest = await writeDigest(
      {
        subject: data.subject as string | null,
        textBody: data.text_body as string | null,
        htmlBody: data.html_body as string | null,
      },
      { client, onSpend: (report) => reports.push(report), localArea },
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
      : data.summary
        ? {}
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

  // A new summary over an old one rewrites the stories array, and a pass or a
  // story's group names a story by its position in it, so the old rows would
  // now name the wrong stories. A first summary has none to clear.
  if (outcome.status === 'digested' && data.summary) {
    for (const table of ['story_passes', 'story_groups'] as const) {
      const cleared = await input.news
        .from(table)
        .delete()
        .eq('issue_id', input.issueId)
        .eq('user_id', input.userId);
      if (cleared.error) {
        throw new Error(`news: clearing ${table} failed (${cleared.error.message})`);
      }
    }
  }
  return outcome;
}
