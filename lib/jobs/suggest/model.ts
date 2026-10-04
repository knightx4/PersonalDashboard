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
  CONNECT_NOTE_MAX,
  MAX_OPENINGS,
  MAX_OUTREACH,
  parseOpeningsPayload,
  parsePeoplePayload,
  type OpeningSuggestion,
  type PersonSuggestion,
} from './payload';
import type { BoardPosting } from './board-pick';
import { preferenceLines, type JobPreferences } from './preferences';
import { MODELS } from '@/lib/core/models';

export const SUGGEST_MODEL = MODELS.jobsSuggest;
/** Each search is billed, and its results come back as input. */
const MAX_SEARCHES = 5;
/**
 * How long a call may run when the caller sets no deadline. With a deadline
 * (the button and the cron both set one, inside their five-minute requests)
 * a call gets the time left before it instead, less RESERVE_MS for storing
 * the result. A fixed 110 seconds stopped searches that needed two minutes.
 */
const DEFAULT_CALL_MS = 240_000;
/**
 * Room for the reply. Thinking is on by default on this model and counts
 * against it: the search of 30 September spent 13,041 output tokens against
 * a cap of 8,000, was cut off inside the report, and stored nothing.
 */
const MAX_TOKENS = 32_000;
/** Kept back from the deadline for parsing and storing what was found. */
const RESERVE_MS = 15_000;
/** A call started with less time than this would only be stopped. */
const MIN_CALL_MS = 45_000;
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
  /** Location, workplace, pay floor and company stage, as set on /jobs/settings. */
  preferences: JobPreferences;
};

export type SuggestOptions = {
  apiKey: string;
  /** Overridable for tests. */
  client?: Pick<Anthropic, 'messages'>;
  onSpend?: SpendSink;
  /** Epoch milliseconds by which the calls must be done; see DEFAULT_CALL_MS. */
  deadline?: number;
};

/** A Messages request that ran out of time, to finish as a batch (search-batch.ts). */
export type SearchRequest = Anthropic.MessageCreateParamsNonStreaming;

export type SuggestResult<T> =
  | { ok: true; suggestions: T[] }
  | { ok: false; error: string; queue?: SearchRequest };

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
  const preferences = preferenceLines(seeker.preferences);
  if (preferences.length > 0) lines.push('', 'What they want from a job (rules, not wishes):', ...preferences);
  if (seeker.goals.length > 0) {
    lines.push('', 'What they wrote about the job they want, newest first (the newer entry wins):', '', goalsText(seeker.goals));
  }
  if (seeker.resume) lines.push('', 'Their CV:', '', seeker.resume.slice(0, RESUME_MAX_CHARS));
  return lines.join('\n');
}

function failure(error: unknown): { ok: false; error: string } {
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return { ok: false, error: 'The web search took too long and was stopped. Try again.' };
  }
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

export const PEOPLE_TOOL = 'suggest_people';

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
  linkedin_connect. For an event, use event.
- message: the message itself, ready to send, written as the next section
  says. For an event, it is what to say when introducing themselves there.
  For an email, make the first line "Subject: " and a short, plain subject,
  then a blank line, then the body.

Writing the message

It goes out under their name to a stranger who owes them nothing and gets
messages like it every week. Write what a busy person would answer: the note
someone sharp and a little informal types themselves, not a cover letter.

- Open with the other person, not the job seeker: the specific thing that
  prompted the message, such as a line from their talk or article, a move
  they made, or a team they built. If nothing specific to this person can be
  named, they are the wrong suggestion.
- Say who the job seeker is in one short clause, and only the part that
  matters to this reader. Never a list of credentials, a degree and class
  year, or "I'm now aiming at" a list of roles.
- End with one real question this person could answer in a two-line reply,
  about their work or the move they made. Do not ask for "fifteen minutes"
  or a call in a connection note. An email may offer a short call after the
  question, once, as an aside.
- Never ask for a job, a referral or "who else I should talk to" in a first
  message.
- A connection note is at most ${CONNECT_NOTE_MAX} characters, spaces included, and
  usually 150 to 250: count before you report it, since a longer one is
  thrown away. Anything else is under 80 words.
- No sign-off or name at the end of a LinkedIn note. An email signs off with
  the first name only.
- Contractions and plain sentences, no preamble, no thanks in advance. Never
  write "I'm reaching out", "I hope this finds you well", "I came across",
  "caught my eye", "I'd love to", "I'd appreciate", "I'd be grateful", "pick
  your brain", "on my list", "fellow alum", "happy to work around your
  schedule", "whatever time works" or "I know you're busy".
- When samples of their own emails are given, match them: their greeting,
  their sentence length, how formal they are, how they sign off an email.
  The samples show how they sound, not what to say; never copy their content.

A message nobody answers:
"Hi Dana, I'm a 2026 MBA graduate of State University, and before that I
spent three years in FP&A at Acme. I'm now pursuing strategic finance roles
in New York, and Ramp is on my list. Could I have fifteen minutes to hear
about your path? I'd really appreciate it."

One that gets a reply:
"Hi Dana, your post on moving Ramp's forecast to weekly cash got me
rethinking ours at Acme. I'm in FP&A and trying to get into strategic
finance. Was that move a different job, or the same one with more say?"

Never suggest anyone on the lists of people they already know or were already
suggested, and never anyone whose company works in an industry they will not
work in${seeker.excludedIndustries.length > 0 ? ` (${seeker.excludedIndustries.join(', ')})` : ''}, even as a
finance role there. Write headline, why and move to the job seeker, as "you",
never he, she or they; the message stays in their own voice. Write plainly. Do not use these anywhere: ${[...seeker.banned, '—'].map((b) => `"${b}"`).join(', ')}.${
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
  /** Short emails they sent, to write the messages in their voice (voice.ts). */
  voice?: readonly string[];
};

function voiceText(samples: readonly string[]): string {
  if (samples.length === 0) return '';
  const blocks = samples.map((sample, i) => `Sample ${i + 1}:\n${sample}`);
  return `\n\nEmails they wrote themselves, for how they sound (not what to say):\n\n${blocks.join('\n\n')}`;
}

export async function findPeople(
  options: SuggestOptions,
  input: PeopleInput,
): Promise<SuggestResult<PersonSuggestion>> {
  const client = options.client ?? new Anthropic({ apiKey: options.apiKey });
  const prompt =
    seekerText(input.seeker) +
    listed('People they know who could introduce them (a good way in, not a suggestion on their own)', input.warm, 30) +
    listed('Already contacts or already suggested (do not suggest these)', input.known, 150) +
    voiceText(input.voice ?? []) +
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
 * without a report (a long search pauses the turn, the model ends with prose,
 * or the report is cut off at the token cap), the second call asks for the
 * report, so it writes up what the searches found instead of searching again. Letting a paused turn carry on
 * as the server offers cost $1.11 for one press on the first day: every resume
 * sends the whole conversation, search results included, back as input.
 *
 * Each call runs until the deadline (see DEFAULT_CALL_MS). A call that would
 * start too close to it, or that runs out of time, is not lost: the result
 * carries the request as `queue`, and the caller finishes it as a Message
 * Batch in the background (search-batch.ts), which has no time limit.
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
  const first: SearchRequest = {
    model: SUGGEST_MODEL,
    max_tokens: MAX_TOKENS,
    system: call.system,
    tools,
    messages: [{ role: 'user', content: call.prompt }],
  };
  const timeLeft = () =>
    options.deadline ? options.deadline - Date.now() - RESERVE_MS : DEFAULT_CALL_MS;
  const outOfTime = (request: SearchRequest): SuggestResult<T> => ({
    ok: false,
    error: 'The web search needed more time than the page allows, so it carries on in the background.',
    queue: request,
  });

  let request = first;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const budget = timeLeft();
    if (budget < MIN_CALL_MS) return outOfTime(request);
    let response: Anthropic.Message;
    // Streamed, and read whole with finalMessage(): the SDK refuses a plain
    // request whose max_tokens could run past ten minutes, whatever timeout
    // it is given (the press of 30 September failed on exactly that). The
    // deadline is kept by aborting the stream.
    const signal = AbortSignal.timeout(budget);
    try {
      response = await client.messages.stream(request, { signal, timeout: budget, maxRetries: 0 }).finalMessage();
    } catch (error) {
      if (
        signal.aborted ||
        error instanceof Anthropic.APIConnectionTimeoutError ||
        error instanceof Anthropic.APIUserAbortError
      ) {
        return outOfTime(request);
      }
      return failure(error);
    }
    options.onSpend?.({ model: SUGGEST_MODEL, usage: usageFrom(response.usage) });
    const step = searchStep(request, response, call.tool.name, call.parse);
    if (step.kind === 'report') return { ok: true, suggestions: step.suggestions };
    if (step.kind === 'refused' || attempt === 1) return { ok: false, error: call.empty };
    request = step.next;
  }
  return { ok: false, error: call.empty };
}

/** What one response means for the search: a report, a refusal, or the next request to make. */
export type SearchStep<T> =
  | { kind: 'report'; suggestions: T[] }
  | { kind: 'refused' }
  | { kind: 'next'; next: SearchRequest };

/**
 * Read one response of a search. Shared by the live calls above and the
 * batch collector, so a search finished in the background is read exactly
 * as one finished on the press.
 */
export function searchStep<T>(
  request: SearchRequest,
  response: Pick<Anthropic.Message, 'content' | 'stop_reason'>,
  toolName: string,
  parse: (raw: unknown) => T[],
): SearchStep<T> {
  // Widened: the installed SDK's type predates some reasons.
  const stop: string | null = response.stop_reason;
  const report = response.content.find((block) => block.type === 'tool_use' && block.name === toolName);
  // A report cut off by the token cap arrives as a call with an empty or
  // partial input. Reading it would store nothing and call that a result,
  // which is what the search of 30 September did.
  const cutOff = stop === 'max_tokens';
  if (report && report.type === 'tool_use' && !cutOff) {
    const suggestions = parse(report.input);
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
      console.warn(`[jobs suggestions] ${toolName} kept nothing`, JSON.stringify({ stop, shape }));
    }
    return { kind: 'report', suggestions };
  }
  if (stop === 'refusal') return { kind: 'refused' };

  // The report is asked for in words rather than forced: this model thinks by
  // default, forcing a tool is not allowed alongside thinking, and newer
  // models reject it outright. A cut-off report is left out of what goes
  // back, since a tool call without its result cannot be sent on.
  const content = cutOff
    ? response.content.filter((block) => !(block.type === 'tool_use' && block.name === toolName))
    : response.content;
  const messages: Anthropic.MessageParam[] = [...request.messages];
  if (content.length > 0) messages.push({ role: 'assistant', content });
  if (cutOff) {
    messages.push({
      role: 'user',
      content: `Your report was cut off before it finished. Call ${toolName} again now with what you found, keeping each field short.`,
    });
  } else if (stop !== 'pause_turn') {
    // A paused turn is sent back as it is; a finished one gets the ask.
    messages.push({ role: 'user', content: `Call ${toolName} now with what you found.` });
  }
  const next: SearchRequest = { ...request, messages };
  delete next.tool_choice;
  return { kind: 'next', next };
}

// ---------------------------------------------------------------------------
// Postings to apply for
// ---------------------------------------------------------------------------

export const OPENINGS_TOOL = 'report_openings';

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
  Where they have set what they want from a job (where they live, how they
  will work, the lowest base pay, company stages), treat it as a rule: leave
  out a posting that states pay below the floor or a workplace they will not
  take. A posting that does not state pay can still go in.
- Learn from what they did with earlier suggestions. Roles they saved show
  what they want more of. Roles they turned down, with the reason, show what
  to avoid: the same level, place, kind of work or company that drew the
  reason. Never suggest a company they turned down for being that company.
- Some openings on the boards of companies they follow may be listed. They
  are open now (read from the company's own board today) and need no search
  to confirm. Include the ones that fit as well as anything the search finds,
  using the link as given; leave out the rest.
- Weigh the newest career goals entry most. When it names the kind of work or
  company they want most, fill the list with that first. When it asks for
  fewer of a kind of role without ruling it out, include at most one of that
  kind, and only when it is a strong match.
- Up to ${MAX_OPENINGS}. Fewer, well matched, beat a padded list.

For each, give:
- company, title, url, location (as the posting states it, or null).
- industry: the company's industry in a few words ("AI software for
  finance", "payments", "investment bank").
- why: one or two sentences on why it fits them, from what they wrote.
- move: how to go about it, as two or three short numbered steps: what to
  lead with in the application, and who to look for at the company for a
  referral before applying.

Write why and move to the person, as "you": "You applied to a strategist
role here in May". Never he, she or they for them, and never "the candidate".

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
  /** Earlier suggestions they saved ("Title at Company") and turned down ("Title at Company (reason)"). */
  feedback: { saved: readonly string[]; dismissed: readonly string[] };
  /** Open postings on the followed companies' boards, already narrowed (board-pick.ts). */
  boardOpenings: readonly BoardPosting[];
  /**
   * Postings already suggested, by link, roles already on file, by roleKey,
   * and companies turned down for being that company, by companyKey.
   */
  taken: { urls: ReadonlySet<string>; roles: ReadonlySet<string>; companies: ReadonlySet<string> };
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
    listed('Suggested roles they saved (more like these)', input.feedback.saved, 30) +
    listed('Suggested roles they turned down, and why', input.feedback.dismissed, 30) +
    listed(
      'Open now on the boards of companies they follow (title | company | location | link)',
      input.boardOpenings.map((p) => `${p.title} | ${p.company} | ${p.location ?? 'location not given'} | ${p.url}`),
      40,
    ) +
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
