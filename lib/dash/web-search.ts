import type Anthropic from '@anthropic-ai/sdk';
import { HAIKU } from '@/lib/core/models';
import type { TalkCitation } from '@/lib/talk/talk';

/**
 * Web search for Ask Dash and the people on People (plan #2861).
 *
 * Anthropic's own web search, run on their side and offered beside the
 * registry tools, so the model calls it only when the person's rows cannot
 * answer: a name it does not recognise, news, a fact about the world. A
 * search costs only when it is made, and each one is priced into the spend
 * the answer records (usageFrom counts `web_search_requests`, and
 * costMicrosFor adds WEB_SEARCH_MICROS apiece).
 *
 * A page a search returned is cited like a row: under the table `web`, with
 * its address as the ref, so the answer's `cited` names it the way it names
 * an order or a note, and the loop keeps only pages a search in this answer
 * returned (searchedPages).
 */

/** The most searches one answer may make. A lookup on the web is a fact or two, not research. */
export const MAX_WEB_SEARCHES = 3;

/** The table a web page is cited under. */
export const WEB_TABLE = 'web';

/**
 * The search tool for a model. The filtering variant (`web_search_20260209`)
 * runs on Opus and Sonnet only, so Haiku, which a person may choose to be
 * answered with, gets the basic one.
 */
export function dashWebSearch(model: string): Anthropic.ToolUnion {
  return {
    type: model === HAIKU ? 'web_search_20250305' : 'web_search_20260209',
    name: 'web_search',
    max_uses: MAX_WEB_SEARCHES,
  } as unknown as Anthropic.ToolUnion;
}

/** The host a page lives on, without a leading www; null for an address that is not http(s). */
function hostOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

/**
 * A web page as an answer cites it: its title with the site it is on, so a
 * page reads apart from the person's own rows, and its address to open.
 * Null for an address that is not a web page.
 */
export function webCitation(url: string, title: string | null | undefined): TalkCitation | null {
  const host = hostOf(url);
  if (!host) return null;
  const name = (title ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
  return { table: WEB_TABLE, ref: url, title: name ? `${name} (${host})` : host, href: url };
}

type Block = { type: string; content?: unknown; citations?: unknown };

/**
 * Every page the searches in one response returned, and every page its text
 * cited, as citations. A search that failed returns an error object in place
 * of its list and adds nothing.
 */
export function searchedPages(content: readonly Block[]): TalkCitation[] {
  const pages: TalkCitation[] = [];
  const add = (url: unknown, title: unknown) => {
    if (typeof url !== 'string') return;
    const page = webCitation(url, typeof title === 'string' ? title : null);
    if (page) pages.push(page);
  };
  for (const block of content) {
    if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) {
      for (const result of block.content as { type?: unknown; url?: unknown; title?: unknown }[]) {
        if (result?.type === 'web_search_result') add(result.url, result.title);
      }
    }
    if (block.type === 'text' && Array.isArray(block.citations)) {
      for (const citation of block.citations as { type?: unknown; url?: unknown; title?: unknown }[]) {
        if (citation?.type === 'web_search_result_location') add(citation.url, citation.title);
      }
    }
  }
  return pages;
}

/**
 * The pages a prose answer's text cited, once each: what an answer written
 * as text rather than through `answer` rests on.
 */
export function textCitedPages(content: readonly Block[]): TalkCitation[] {
  const seen = new Set<string>();
  return searchedPages(content.filter((block) => block.type === 'text')).filter((page) => {
    if (seen.has(page.ref)) return false;
    seen.add(page.ref);
    return true;
  });
}

/**
 * The rules for the web, told to every voice that has the search: Ask's and
 * each person's on People.
 */
export const WEB_RULES = `THE WEB IS FOR WHAT THEIR THINGS CANNOT HOLD. You can search the web with
web_search, at most ${MAX_WEB_SEARCHES} times an answer. Their own rows come first:
a question about their spending, their notes, their roles, their goals or
anything else they keep is answered from the lookups, and never searched.
Search only when the lookups cannot answer it: a name or a thing you do not
recognise and their rows do not explain, news, a price or a fact about the
world. When a name might be theirs, look it up in their rows first and search
only if nothing comes back. Say which part of the answer came from the web,
and cite each page it rests on in cited, with the table web and the page's
address as the ref, the way you cite their rows. Cite only pages a search
returned.`;
