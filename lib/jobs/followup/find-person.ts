/**
 * The hiring manager for one application, found on the public web.
 *
 * Used only when nobody on file at the company will do (person.ts). One web
 * search conversation, the same as the people search's (searchThenReport in
 * suggest/model.ts), asked for a single named person: whoever the role
 * reports to, else the person who leads that team, else the recruiter for
 * it. It reads public pages only (team pages, posts, talks, articles, public
 * profiles), the same rule as the people search: nothing behind a login.
 */
import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { searchThenReport, seekerText, type SeekerContext, type SuggestOptions, type SuggestResult } from '@/lib/jobs/suggest/model';
import { cleanText, listIn } from '@/lib/jobs/suggest/payload';

export const FIND_PERSON_TOOL = 'report_person';
const JD_MAX_CHARS = 4_000;

export type FoundPerson = {
  name: string;
  title: string | null;
  sourceUrl: string | null;
  linkedinUrl: string | null;
  why: string;
};

export type FindPersonInput = {
  seeker: SeekerContext;
  company: string;
  website: string | null;
  role: string;
  jdText: string | null;
  /** Names already on file at the company, who were passed over. */
  known: readonly string[];
};

const SYSTEM = `You find the one person someone in a job search should tell about an
application they have made, or are about to make. Search the public web for
that person at the company named:

1. Whoever this role reports to, when the posting says (a title such as "Head
   of Strategic Finance") and you can find who holds that title now.
2. Otherwise the person who leads the team the role sits in.
3. Otherwise the recruiter or talent partner who hires for that team.

Use public pages only: the company's team or about pages, its blog, posts,
talks, podcasts, press, and public profiles. They must work there now; a page
older than two years is not enough on its own. Never a founder of a company
over a few hundred people unless the role reports to them. Never someone on
the list they already know at the company.

Report one person, or an empty list when you cannot name anyone with
confidence. A wrong name is worse than none: they would write to a stranger
who has nothing to do with the role.

For the person give name and title as the source states them, source_url
(the page that shows they hold the job), linkedin_url when a public profile
link turned up (else null), and why: one sentence to the job seeker, as
"you", on why this is the person ("The posting says the role reports to the
Head of FP&A, which is Dana Wu."). Write plainly, with no em dashes.`;

/** The reported person, at most one, with links that are not web pages dropped. */
export function parsePeople(raw: unknown): FoundPerson[] {
  const found: FoundPerson[] = [];
  for (const item of listIn(raw, 'people').slice(0, 1)) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const name = typeof row.name === 'string' ? cleanText(row.name).trim() : '';
    const why = typeof row.why === 'string' ? cleanText(row.why).trim() : '';
    if (!name || !why) continue;
    const text = (value: unknown) => (typeof value === 'string' && value.trim() ? cleanText(value).trim() : null);
    const link = (value: unknown) => {
      const url = text(value);
      return url && /^https?:\/\//.test(url) ? url : null;
    };
    const linkedin = link(row.linkedin_url);
    found.push({
      name,
      title: text(row.title),
      sourceUrl: link(row.source_url),
      linkedinUrl: linkedin && /linkedin\.com\/in\//.test(linkedin) ? linkedin : null,
      why,
    });
  }
  return found;
}

export async function findFollowUpPerson(
  options: SuggestOptions,
  input: FindPersonInput,
): Promise<SuggestResult<FoundPerson>> {
  const client = options.client ?? new Anthropic({ apiKey: options.apiKey });
  const lines = [
    seekerText(input.seeker),
    '',
    `The company: ${input.company}${input.website ? ` (${input.website})` : ''}`,
    `The role: ${input.role}`,
  ];
  if (input.jdText?.trim()) lines.push('', 'The posting:', input.jdText.trim().slice(0, JD_MAX_CHARS));
  if (input.known.length > 0) {
    lines.push('', 'Already on file at the company (do not report these):', ...input.known.slice(0, 40).map((n) => `- ${n}`));
  }
  lines.push('', `Search, then call ${FIND_PERSON_TOOL} once.`);

  return searchThenReport(client, options, {
    system: SYSTEM,
    prompt: lines.join('\n'),
    tool: {
      name: FIND_PERSON_TOOL,
      description: 'Report the one person to follow this application up with, or an empty list.',
      input_schema: {
        type: 'object',
        properties: {
          people: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                title: { type: ['string', 'null'] },
                source_url: { type: ['string', 'null'] },
                linkedin_url: { type: ['string', 'null'] },
                why: { type: 'string' },
              },
              required: ['name', 'why'],
            },
          },
        },
        required: ['people'],
      },
    },
    parse: parsePeople,
    empty: 'Dash could not name anyone there with confidence.',
  });
}
