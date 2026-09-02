/**
 * Company research from a web search, for the companies Wikidata has never
 * heard of.
 *
 * Wikidata only carries companies notable enough to have an encyclopedia
 * entry, so a small or recent employer returns nothing there ("Nothing on
 * Wikidata matches that name" in the propose flow) and the record stays
 * blank forever. Claude's server-side web search reads the company's own
 * site and reports back its homepage and what it does, the same way the sell
 * assistant prices a book it cannot find in a catalog.
 */
import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { parseCompanyLookupPayload, type CompanyLookupResult } from './ai-company-payload';

const MODEL = 'claude-haiku-4-5';
const TOOL_NAME = 'report_company';
/** Each search is billed. Three covers a homepage search and a fallback. */
const MAX_SEARCHES = 3;

const SYSTEM = `You research employers for a job search assistant.

Given a company name and whatever else is already known about it, search the
web and find:
- website: the company's own official homepage (not a job board, not
  LinkedIn, not Crunchbase, not a news article -- the corporate site itself).
  Root domain is fine; no need for a specific page.
- summary: two or three plain sentences on what the company actually does.
  No marketing language lifted verbatim from their homepage -- describe it
  the way you would explain it to someone who has never heard of them.

If you cannot confidently identify the right company -- the name is common
and nothing narrows it down, or nothing usable turns up -- set no_data true
and leave website and summary null rather than guessing.`;

export type AiCompanyLookupInput = {
  name: string;
  /** Domains already on file, industry, HQ location -- whatever disambiguates a common name. */
  hints?: string | null;
};

export type AiCompanyLookupOptions = {
  apiKey: string;
  /** Overridable for tests. */
  client?: Anthropic;
};

export async function lookupCompanyOnline(
  options: AiCompanyLookupOptions,
  input: AiCompanyLookupInput,
): Promise<CompanyLookupResult> {
  const client = options.client ?? new Anthropic({ apiKey: options.apiKey });

  let response;
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM,
      tools: [
        {
          // The dynamic-filtering 20260209 variant is Opus/Sonnet-tier only;
          // Haiku needs the basic tool or every call 400s.
          type: 'web_search_20250305',
          name: 'web_search',
          max_uses: MAX_SEARCHES,
        } as unknown as Anthropic.Tool,
        {
          name: TOOL_NAME,
          description: "Report the company's homepage and what it does.",
          input_schema: {
            type: 'object',
            properties: {
              website: { type: ['string', 'null'] },
              summary: { type: ['string', 'null'] },
              sources: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    title: { type: ['string', 'null'] },
                    url: { type: 'string' },
                  },
                  required: ['url'],
                },
              },
              no_data: { type: 'boolean' },
            },
            required: ['no_data'],
          },
        },
      ],
      messages: [
        {
          role: 'user',
          content: `Company: ${input.name}${
            input.hints ? `\nAlready known: ${input.hints}` : ''
          }\n\nSearch, then call ${TOOL_NAME}.`,
        },
      ],
    });
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) {
      return { ok: false, error: 'Company lookups are rate-limited right now.' };
    }
    if (error instanceof Anthropic.APIError) {
      return { ok: false, error: `Lookup failed (${error.status}).` };
    }
    return { ok: false, error: error instanceof Error ? error.message : 'Lookup failed.' };
  }

  const report = response.content.find(
    (block) => block.type === 'tool_use' && block.name === TOOL_NAME,
  );
  if (!report || report.type !== 'tool_use') {
    return { ok: false, error: 'No report came back.' };
  }

  return parseCompanyLookupPayload(report.input);
}
