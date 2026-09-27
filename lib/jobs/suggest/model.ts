/**
 * The two model calls behind Dash's job search suggestions.
 *
 * `suggestOutreach` chooses up to three people from the candidates
 * (candidates.ts) and writes, for each, why now, what to do and the message to
 * send. `findOpenings` searches the web for open postings that fit what the
 * person wrote about the job they want, leaving out what they have already
 * applied for.
 *
 * Sonnet for both: the messages go out under the person's name, so they need
 * better writing than Haiku gives, and neither call needs Opus's judgement.
 */
import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import type { Candidate } from './candidates';
import {
  CHANNELS,
  MAX_OPENINGS,
  MAX_OUTREACH,
  parseOpeningsPayload,
  parseOutreachPayload,
  type OpeningSuggestion,
  type OutreachSuggestion,
} from './payload';

export const SUGGEST_MODEL = 'claude-sonnet-5';
/** Each search is billed. Six covers a few titles in a couple of places. */
const MAX_SEARCHES = 6;
/** Rounds of searching the server may pause after before it is given up. */
const MAX_CONTINUATIONS = 2;
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

const OUTREACH_TOOL = 'suggest_outreach';

function outreachSystem(seeker: SeekerContext): string {
  return `You help someone in a job search decide who to contact this week and
exactly what to say. You are given a numbered list of candidates: people they
already know of, and companies where they have applied but know nobody.

Choose up to ${MAX_OUTREACH}, the ones where a message could change something
now: someone at a company where an application is live, a recruiter who
replied before and hires for other roles, a friend or former colleague who can
refer them. Leave out anyone where a message now would be pointless or pushy.
Fewer strong suggestions beat three weak ones.

For each, give:
- ref: the candidate's ref, exactly as given.
- headline: who and what, in a few words. "Ask Priya Shah for a referral at
  Acme", "Find the analytics lead at Globex".
- why: one or two sentences on why this person and why now, from the facts.
- move: what to do, as two to four short numbered steps. For a company with
  nobody on file, name the title to look for and the LinkedIn search to run,
  then what to send once found.
- channel: one of ${CHANNELS.join(', ')}. A LinkedIn connection note is
  linkedin_connect and must be under 300 characters.
- message: the message itself, ready to send, in their voice. Short: under 120
  words for an email or DM. Specific to the person and the role, with one
  clear ask (a referral, a 15-minute call, whether the role is still open, who
  owns hiring for it). No flattery, no filler, no "I hope this finds you
  well". Where a name is unknown, write [Name] for it. For an email, make the
  first line "Subject: " and the subject, then a blank line, then the body.

Write plainly. Do not use these anywhere: ${[...seeker.banned, '—'].map((b) => `"${b}"`).join(', ')}.${
    seeker.writingStyle ? `\n\nHow they like their writing to sound: ${seeker.writingStyle}` : ''
  }

If no candidate is worth a message, return an empty list.`;
}

export async function suggestOutreach(
  options: SuggestOptions,
  input: { seeker: SeekerContext; candidates: readonly Candidate[] },
): Promise<SuggestResult<OutreachSuggestion>> {
  if (input.candidates.length === 0) return { ok: true, suggestions: [] };
  const client = options.client ?? new Anthropic({ apiKey: options.apiKey });

  const prompt = [
    seekerText(input.seeker),
    '',
    'Candidates:',
    ...input.candidates.map((candidate) => `\n[${candidate.ref}]\n${candidate.facts.join('\n')}`),
    '',
    `Call ${OUTREACH_TOOL}.`,
  ].join('\n');

  let response;
  try {
    response = await client.messages.create({
      model: SUGGEST_MODEL,
      max_tokens: 4096,
      system: outreachSystem(input.seeker),
      tools: [
        {
          name: OUTREACH_TOOL,
          description: 'Report the people to contact and what to send each.',
          input_schema: {
            type: 'object',
            properties: {
              suggestions: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    ref: { type: 'string' },
                    headline: { type: 'string' },
                    why: { type: 'string' },
                    move: { type: 'string' },
                    channel: { type: 'string', enum: [...CHANNELS] },
                    message: { type: 'string' },
                  },
                  required: ['ref', 'headline', 'why', 'move', 'channel', 'message'],
                },
              },
            },
            required: ['suggestions'],
          },
        },
      ],
      tool_choice: { type: 'tool', name: OUTREACH_TOOL },
      messages: [{ role: 'user', content: prompt }],
    });
  } catch (error) {
    return failure(error);
  }
  options.onSpend?.({ model: SUGGEST_MODEL, usage: usageFrom(response.usage) });

  const report = response.content.find((block) => block.type === 'tool_use' && block.name === OUTREACH_TOOL);
  if (!report || report.type !== 'tool_use') return { ok: false, error: 'No suggestions came back.' };
  return { ok: true, suggestions: parseOutreachPayload(report.input, input.candidates) };
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
- Match the location and seniority their writing and past roles point to.
- Up to ${MAX_OPENINGS}. Fewer, well matched, beat a padded list.

For each, give:
- company, title, url, location (as the posting states it, or null).
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

  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: prompt }];
  try {
    for (let turn = 0; turn <= MAX_CONTINUATIONS; turn += 1) {
      const response = await client.messages.create({
        model: SUGGEST_MODEL,
        max_tokens: 8000,
        system: OPENINGS_SYSTEM,
        tools: [
          { type: 'web_search_20260209', name: 'web_search', max_uses: MAX_SEARCHES } as unknown as Anthropic.Tool,
          {
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
                      title: { type: 'string' },
                      url: { type: 'string' },
                      location: { type: ['string', 'null'] },
                      why: { type: 'string' },
                      move: { type: 'string' },
                    },
                    required: ['company', 'title', 'url', 'why', 'move'],
                  },
                },
              },
              required: ['openings'],
            },
          },
        ],
        messages,
      });
      options.onSpend?.({ model: SUGGEST_MODEL, usage: usageFrom(response.usage) });

      const report = response.content.find((block) => block.type === 'tool_use' && block.name === OPENINGS_TOOL);
      if (report && report.type === 'tool_use') {
        return { ok: true, suggestions: parseOpeningsPayload(report.input, input.taken) };
      }
      // Widened: the installed SDK's type predates this reason.
      const stop: string | null = response.stop_reason;
      if (stop === 'pause_turn') {
        messages.push({ role: 'assistant', content: response.content });
        continue;
      }
      return { ok: false, error: 'The search ran but reported no postings.' };
    }
  } catch (error) {
    return failure(error);
  }
  return { ok: false, error: 'The search did not finish.' };
}
