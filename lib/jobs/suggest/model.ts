/**
 * The two model calls behind Dash's job search suggestions.
 *
 * `findPeople` searches the web for up to three people the person has not met
 * who fit the work they want (or an event where they would meet them), and
 * writes, for each, why, what to do and the message to send. `findOpenings`
 * searches for open postings that fit, leaving out what they have already
 * applied for. Both use the career goals, the target titles and the CV.
 *
 * Sonnet for both: the messages go out under the person's name, so they need
 * better writing than Haiku gives, and the web search tool's dynamic filtering
 * is not available on Haiku.
 */
import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import {
  CHANNELS,
  MAX_OPENINGS,
  MAX_OUTREACH,
  parseOpeningsPayload,
  parsePeoplePayload,
  type OpeningSuggestion,
  type PersonSuggestion,
} from './payload';

export const SUGGEST_MODEL = 'claude-sonnet-5';
/** Each search is billed, and its results come back as input. */
const MAX_SEARCHES = 5;
const GOALS_MAX_CHARS = 8_000;
const RESUME_MAX_CHARS = 5_000;

/** What both calls know about the person. */
export type SeekerContext = {
  name: string | null;
  /** Career goals entries, newest first. */
  goals: readonly { written: string; body: string }[];
  targetTitles: readonly string[];
  resume: string | null;
  writingStyle: string | null;
  banned: readonly string[];
  /** Industries never to suggest; checked again after the call. */
  excludedIndustries: readonly string[];
};

export type SuggestOptions = {
  apiKey: string;
  /** Overridable for tests. */
  client?: Pick<Anthropic, 'messages'>;
  onSpend?: SpendSink;
};

export type SuggestResult<T> = { ok: true; suggestions: T[] } | { ok: false; error: string };

function goalsText(goals: SeekerContext['goals']): string {
  const parts: string[] = [];
  let used = 0;
  for (const [index, entry] of goals.entries()) {
    const block = `## ${entry.written}${index === 0 ? ' (latest)' : ''}\n\n${entry.body.trim()}`;
    if (used + block.length > GOALS_MAX_CHARS) {
      if (index === 0) parts.push(block.slice(0, GOALS_MAX_CHARS));
      break;
    }
    parts.push(block);
    used += block.length;
  }
  return parts.join('\n\n');
}

function seekerText(seeker: SeekerContext): string {
  const lines: string[] = [];
  if (seeker.name) lines.push(`Their name: ${seeker.name}`);
  if (seeker.targetTitles.length > 0) lines.push(`Titles they are targeting: ${seeker.targetTitles.join(', ')}`);
  if (seeker.excludedIndustries.length > 0) {
    lines.push(`Industries they will not work in: ${seeker.excludedIndustries.join(', ')}`);
  }
  if (seeker.goals.length > 0) {
    lines.push('', 'What they wrote about the job they want, newest first (the newer entry wins):', '', goalsText(seeker.goals));
  }
  if (seeker.resume) lines.push('', 'Their CV:', '', seeker.resume.slice(0, RESUME_MAX_CHARS));
  return lines.join('\n');
}

function failure(error: unknown): { ok: false; error: string } {
  if (error instanceof Anthropic.RateLimitError) {
    return { ok: false, error: 'Dash is rate-limited right now. Try again in a minute.' };
  }
  if (error instanceof Anthropic.APIError) {
    return { ok: false, error: `The suggestions could not be made (${error.status}).` };
  }
  return { ok: false, error: error instanceof Error ? error.message : 'The suggestions could not be made.' };
}

// ---------------------------------------------------------------------------
// People to contact
// ---------------------------------------------------------------------------

const PEOPLE_TOOL = 'suggest_people';

function peopleSystem(seeker: SeekerContext): string {
  return `You help someone in a job search build their network. Your job is to find
people they have not met yet who are worth contacting this week, and to write
exactly what to say. Not follow-ups on applications they already sent: new
people, chosen because of the work they want next.

Search the web for up to ${MAX_OUTREACH} of the best of these:
- A named person doing the job they want, or one level above it, at a company
  that fits what they wrote: found on a company team page, a conference or
  podcast speaker list, an article they wrote or were quoted in, or a public
  profile. Someone who shares something with them is better: the same
  university, a former employer in common, the same city.
- A hiring manager or team lead for the kind of role they want, at a company
  that is growing or hiring for it now.
- An event, meetup or professional community for their field where they would
  meet such people, in or near the place they live, happening soon. Only when
  it is concrete: a named group or a dated event with a link.

Mix them; do not return three of one kind unless the others are weak. Prefer
reachable people (with a public profile or a way in) over famous ones.

For each, give:
- person_name and person_title as the source states them, and company. For an
  event or group, person_name is null and company is the organiser.
- industry: the company's industry in a few words ("AI software for
  finance", "investment bank"). For an event, the field it serves.
- source_url: the page where you found them.
- search_query: a LinkedIn people search that finds this person, or people
  like them if the name may be wrong. Short: name and company, or title,
  company and school.
- headline: who and what, in a few words. "Ask Dana Wu about strategic finance
  at Ramp", "Go to the NYC FP&A meetup on 8 October".
- why: one or two sentences on why this person and why now, naming the thing
  they share with the job seeker or the reason they are worth their time.
- move: two to four short numbered steps: how to find them, what to send,
  and what to do if they reply.
- channel: one of ${CHANNELS.join(', ')}. A LinkedIn connection note is
  linkedin_connect and must be under 300 characters. For an event, use event.
- message: the message itself, ready to send, in their voice. Short: under 100
  words, a connection note under 300 characters. Name the specific thing that
  prompted it (their talk, their article, the school or employer in common).
  One clear, small ask: a 15-minute call about how they got into the role, or
  their view on one question. Never ask a stranger for a job or a referral in
  the first message. No flattery, no filler. For an event, the message is what
  to say when introducing themselves there. For an email, make the first line
  "Subject: " and the subject, then a blank line, then the body.

Never suggest anyone on the lists of people they already know or were already
suggested, and never anyone whose company works in an industry they will not
work in${seeker.excludedIndustries.length > 0 ? ` (${seeker.excludedIndustries.join(', ')})` : ''}, even as a
finance role there. Write plainly. Do not use these anywhere: ${[...seeker.banned, '—'].map((b) => `"${b}"`).join(', ')}.${
    seeker.writingStyle ? `\n\nHow they like their writing to sound: ${seeker.writingStyle}` : ''
  }

If nothing worth their time turns up, report an empty list rather than a weak
suggestion.`;
}

export type PeopleInput = {
  seeker: SeekerContext;
  /** Friends, former colleagues and alumni already on file, who could introduce them. */
  warm: readonly string[];
  /** Everyone already a contact or already suggested, by name: not to be suggested. */
  known: readonly string[];
  /** personKey of every name in `known`, for the check after the call. */
  taken: ReadonlySet<string>;
};

export async function findPeople(
  options: SuggestOptions,
  input: PeopleInput,
): Promise<SuggestResult<PersonSuggestion>> {
  const client = options.client ?? new Anthropic({ apiKey: options.apiKey });
  const prompt =
    seekerText(input.seeker) +
    listed('People they know who could introduce them (a good way in, not a suggestion on their own)', input.warm, 30) +
    listed('Already contacts or already suggested (do not suggest these)', input.known, 150) +
    `\n\nSearch, then call ${PEOPLE_TOOL} once with every suggestion.`;

  return searchThenReport(client, options, {
    system: peopleSystem(input.seeker),
    prompt,
    tool: {
      name: PEOPLE_TOOL,
      description: 'Report the people and events to contact, and what to send each, all in one call.',
      input_schema: {
        type: 'object',
        properties: {
          suggestions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                person_name: { type: ['string', 'null'] },
                person_title: { type: ['string', 'null'] },
                company: { type: ['string', 'null'] },
                industry: { type: ['string', 'null'] },
                source_url: { type: ['string', 'null'] },
                search_query: { type: ['string', 'null'] },
                headline: { type: 'string' },
                why: { type: 'string' },
                move: { type: 'string' },
                channel: { type: 'string', enum: [...CHANNELS] },
                message: { type: 'string' },
              },
              required: ['headline', 'why', 'move', 'channel', 'message'],
            },
          },
        },
        required: ['suggestions'],
      },
    },
    parse: (raw) => parsePeoplePayload(raw, { people: input.taken }, input.seeker.excludedIndustries),
    empty: 'The search ran but reported no people.',
  });
}

/**
 * One web search conversation that ends in a report.
 *
 * At most two calls. The first searches and, usually, reports. When it stops
 * without a report (a long search pauses the turn, or the model ends with
 * prose), the second call forces the report tool, so it writes up what the
 * searches found instead of searching again. Letting a paused turn carry on
 * as the server offers cost $1.11 for one press on the first day: every resume
 * sends the whole conversation, search results included, back as input.
 */
async function searchThenReport<T>(
  client: Pick<Anthropic, 'messages'>,
  options: SuggestOptions,
  call: {
    system: string;
    prompt: string;
    tool: Anthropic.Tool;
    parse: (raw: unknown) => T[];
    empty: string;
  },
): Promise<SuggestResult<T>> {
  const tools = [
    { type: 'web_search_20260209', name: 'web_search', max_uses: MAX_SEARCHES } as unknown as Anthropic.Tool,
    call.tool,
  ];
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: call.prompt }];

  const read = (response: Anthropic.Message): SuggestResult<T> | null => {
    const report = response.content.find((block) => block.type === 'tool_use' && block.name === call.tool.name);
    if (!report || report.type !== 'tool_use') return null;
    const suggestions = call.parse(report.input);
    if (suggestions.length === 0) {
      // The shape only, never the text: enough to see why a paid report kept
      // nothing, without copying people's names into the logs.
      const input = report.input as Record<string, unknown> | null;
      const shape = Object.fromEntries(
        Object.entries(input ?? {}).map(([key, value]) => [
          key,
          Array.isArray(value) ? `array(${value.length})` : typeof value,
        ]),
      );
      console.warn(`[jobs suggestions] ${call.tool.name} kept nothing`, JSON.stringify(shape));
    }
    return { ok: true, suggestions };
  };

  try {
    const first = await client.messages.create({
      model: SUGGEST_MODEL,
      max_tokens: 8000,
      system: call.system,
      tools,
      messages,
    });
    options.onSpend?.({ model: SUGGEST_MODEL, usage: usageFrom(first.usage) });
    const reported = read(first);
    if (reported) return reported;

    // Widened: the installed SDK's type predates this reason.
    const stop: string | null = first.stop_reason;
    if (stop === 'refusal') return { ok: false, error: call.empty };
    messages.push({ role: 'assistant', content: first.content });
    // A paused turn is sent back as it is; a finished one gets the ask.
    if (stop !== 'pause_turn') {
      messages.push({ role: 'user', content: `Call ${call.tool.name} now with what you found.` });
    }

    const second = await client.messages.create({
      model: SUGGEST_MODEL,
      max_tokens: 8000,
      system: call.system,
      tools,
      tool_choice: { type: 'tool', name: call.tool.name },
      messages,
    });
    options.onSpend?.({ model: SUGGEST_MODEL, usage: usageFrom(second.usage) });
    return read(second) ?? { ok: false, error: call.empty };
  } catch (error) {
    return failure(error);
  }
}

// ---------------------------------------------------------------------------
// Postings to apply for
// ---------------------------------------------------------------------------

const OPENINGS_TOOL = 'report_openings';

const OPENINGS_SYSTEM = `You find open job postings worth applying for, for someone in a job
search. Search the web for current openings that fit what they wrote about the
job they want, their target titles and their CV.

Rules:
- Only postings that are open now, each with a link to the posting itself: the
  company's careers page or its applicant tracking system (Greenhouse, Lever,
  Ashby, Workday and the like). Not an aggregator's search page, not a news
  article. If you only find a role on a job board, link the board's page for
  that one posting.
- Never a role they have already applied for; the list is given. Companies
  they have applied to before are fine for a different role, but prefer new
  ones.
- Never a company in an industry they will not work in, whatever the role:
  a finance job at a crypto firm is still a crypto job. When the industry is
  unclear, look it up before reporting the posting.
- Match the location and seniority their writing and past roles point to.
- Weigh the newest career goals entry most. When it names the kind of work or
  company they want most, fill the list with that first.
- Up to ${MAX_OPENINGS}. Fewer, well matched, beat a padded list.

For each, give:
- company, title, url, location (as the posting states it, or null).
- industry: the company's industry in a few words ("AI software for
  finance", "payments", "investment bank").
- why: one or two sentences on why it fits them, from what they wrote.
- move: how to go about it, as two or three short numbered steps: what to
  lead with in the application, and who to look for at the company for a
  referral before applying.

Write plainly, with no em dashes. If nothing suitable turns up, report an
empty list rather than a weak match.`;

export type OpeningsInput = {
  seeker: SeekerContext;
  /** Roles that got a human reply, as "Title at Company": what has worked. */
  responded: readonly string[];
  /** Recent roles applied to, as "Title at Company". */
  recent: readonly string[];
  /** Places the recent roles were in. */
  locations: readonly string[];
  /** Postings already suggested, by link, and roles already on file, by roleKey. */
  taken: { urls: ReadonlySet<string>; roles: ReadonlySet<string> };
};

function listed(title: string, items: readonly string[], max: number): string {
  if (items.length === 0) return '';
  return `\n\n${title}:\n${items.slice(0, max).map((item) => `- ${item}`).join('\n')}`;
}

export async function findOpenings(
  options: SuggestOptions,
  input: OpeningsInput,
): Promise<SuggestResult<OpeningSuggestion>> {
  const client = options.client ?? new Anthropic({ apiKey: options.apiKey });
  const prompt =
    seekerText(input.seeker) +
    listed('Applications that got a reply from a person', input.responded, 20) +
    listed('Roles they applied to recently (do not suggest these)', input.recent, 40) +
    listed('Where their recent roles were', input.locations, 8) +
    `\n\nSearch, then call ${OPENINGS_TOOL} once with every posting.`;

  return searchThenReport(client, options, {
    system: OPENINGS_SYSTEM,
    prompt,
    tool: {
      name: OPENINGS_TOOL,
      description: 'Report the open postings found, all in one call.',
      input_schema: {
        type: 'object',
        properties: {
          openings: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                company: { type: 'string' },
                industry: { type: 'string' },
                title: { type: 'string' },
                url: { type: 'string' },
                location: { type: ['string', 'null'] },
                why: { type: 'string' },
                move: { type: 'string' },
              },
              required: ['company', 'industry', 'title', 'url', 'why', 'move'],
            },
          },
        },
        required: ['openings'],
      },
    },
    parse: (raw) => parseOpeningsPayload(raw, input.taken, input.seeker.excludedIndustries),
    empty: 'The search ran but reported no postings.',
  });
}
