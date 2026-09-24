/**
 * The prep note: everything the app knows about one round, read back as
 * something you could hold at eight in the morning.
 *
 * The assembly is most of the value and it has already happened — buildPrepContext
 * has put the requirement map, the people, the earlier rounds and the bank on
 * one page. What the call adds is the reading: that two requirements are the
 * same worry stated twice, that the interviewer's title means the conversation
 * is really about scope, that the story you would reach for first is the wrong
 * one for this room.
 *
 * So the call is deliberately small in what it is allowed to invent. It writes
 * prose and it chooses; the facts under the prose come from the context and
 * are checked back against it in prep-payload.ts. A note that quietly wrote
 * around an absent job description would read exactly like one written from a
 * full posting, and the person reading it could not tell which they had.
 *
 * No web search, per the decision on #65: this stays inside what the app
 * already holds. Looking a named private individual up is a thing the person
 * should be choosing to do, not something that happens behind a button that
 * says "prepare me".
 */
import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';

import { PREP_MISSING_LABEL, type PrepContext } from './prep-context';
import { parsePrepPayload, type PrepResult } from './prep-payload';

/** Reading a room off a handful of rows is judgment, not retrieval. */
const MODEL = 'claude-opus-5';
const TOOL_NAME = 'report_prep';

const SYSTEM = `You write an interview prep note for someone, out of their own
records, for a job-search assistant.

You are given their evidence bank, then one scheduled interview round: the
conversations in it, the people they are meeting, the role and how their record
was matched against its requirements, the company, and what earlier rounds at
that company asked. Report:

- round_summary: two or three sentences on what this round is, when it is, and
  who is in it. Concrete. The first thing they read.
- interviewers: one entry per person, contact_id copied exactly, with a short
  paragraph on who they are and what that suggests the conversation will be
  about. Only from what is on file. If all you have is a name and a title, say
  what the title suggests and stop.
- points: the lines of the requirement map worth having thought about, each by
  requirement_index as given, with one sentence on what to say about it — for a
  strong line, the shape of the answer; for a thin one, what to say instead of
  pretending. Do not score the line again; the verdict is already decided.
- stories: the bank items to have ready, evidence_item_id copied exactly, each
  with one sentence on the question it answers. Four or five, not the whole
  bank.
- prior_rounds_note: what earlier rounds at this company seem to care about,
  read off the questions they asked. Omit if there were none.
- questions_to_ask: questions worth asking them, specific to this role, this
  company and this person. Not "what does success look like".
- missing: anything you needed and did not have, in plain sentences.

Rules:

Never invent a fact. Every name, number, title and result comes from what you
were given. If the record does not say whether the team is five people or
fifty, do not guess — that is a line for missing, or a question to ask them.

Never cite an id that was not given to you, and do not write about a person who
is not on the list. An invented id is discarded and the paragraph goes with it.

Say what is thin. A note that only lists strengths is the note that costs them
the interview. Where the map says gap, the useful sentence is what to say when
it comes up, not how to disguise it.

Write it to be read the morning of, not to be impressive. Short paragraphs,
their own vocabulary, no headings inside a field, no preamble about how
exciting the opportunity is, and no closing encouragement.`;

export type PrepInput = {
  context: PrepContext;
  /** `profiles.banned_constructions`, checked against the output afterwards. */
  banned?: readonly string[];
};

export type PrepOptions = {
  apiKey: string;
  /** Overridable for tests. */
  client?: Anthropic;
  /** What the call cost; record it as 'write-interview-prep'. */
  onSpend?: SpendSink;
};

/** The bank, as it goes into the cached prefix. Same rendering as the match. */
function renderBank(context: PrepContext): string {
  return context.bank
    .map((item) =>
      [
        `id: ${item.id}`,
        `title: ${item.title}`,
        item.context ? `where: ${item.context}` : null,
        item.metrics ? `result: ${item.metrics}` : null,
        item.skills.length ? `tags: ${item.skills.join(', ')}` : null,
        `story: ${item.body}`,
      ]
        .filter(Boolean)
        .join('\n'),
    )
    .join('\n\n---\n\n');
}

function renderConversations(context: PrepContext): string {
  return context.round.conversations
    .map((conversation) =>
      [
        `- ${conversation.kindLabel}`,
        conversation.scheduledAt
          ? conversation.timeKnown
            ? `at ${conversation.scheduledAt}`
            : `on ${conversation.scheduledAt} (time not confirmed)`
          : 'not scheduled',
        conversation.durationMinutes ? `${conversation.durationMinutes} minutes` : null,
        conversation.format,
        conversation.interviewerNames.length
          ? `with ${conversation.interviewerNames.join(', ')}`
          : null,
      ]
        .filter(Boolean)
        .join(' · '),
    )
    .join('\n');
}

function renderInterviewers(context: PrepContext): string {
  return context.interviewers
    .map((person) =>
      [
        `contact_id: ${person.contactId}`,
        `name: ${person.name}`,
        person.title ? `title: ${person.title}` : null,
        person.relationship ? `relationship: ${person.relationship}` : null,
        person.howWeConnect ? `how you know them: ${person.howWeConnect}` : null,
        person.linkedinUrl ? `linkedin: ${person.linkedinUrl}` : null,
        person.notes ? `on file: ${person.notes}` : null,
      ]
        .filter(Boolean)
        .join('\n'),
    )
    .join('\n\n');
}

/**
 * The requirement map, numbered the way the match numbers it.
 *
 * The index is what comes back, not the text: asking for forty requirement
 * strings to be echoed wastes output tokens and invites a paraphrase of the
 * line being quoted.
 */
function renderMatches(context: PrepContext): string {
  return context.role.matches
    .map(
      (match, index) =>
        `${index}. [${match.verdict}] [${match.kind}] ${match.requirement}\n   ${match.why}`,
    )
    .join('\n');
}

function renderPriorRounds(context: PrepContext): string {
  return context.priorRounds
    .map((round) =>
      [
        `${round.kindLabel}${round.roleTitle ? ` for ${round.roleTitle}` : ''}${
          round.scheduledAt ? `, ${round.scheduledAt}` : ''
        }`,
        round.questionsAsked.length
          ? `asked:\n${round.questionsAsked.map((question) => `  - ${question}`).join('\n')}`
          : 'no questions recorded',
        round.notes ? `notes: ${round.notes}` : null,
      ]
        .filter(Boolean)
        .join('\n'),
    )
    .join('\n\n');
}

/** Everything but the bank, which is cached separately. */
function renderContext(context: PrepContext): string {
  const { role, company, round } = context;
  return [
    `Round: ${round.label ?? 'unlabelled'}${
      round.roundNumber ? ` (round ${round.roundNumber})` : ''
    }`,
    renderConversations(context) || 'No conversations on this round.',
    round.notes ? `Your notes on the round:\n${round.notes}` : null,
    `Role: ${role.title}${role.seniority ? ` (${role.seniority})` : ''} at ${company.name}`,
    [
      role.location ? `location: ${role.location}` : null,
      role.workMode ? `work mode: ${role.workMode}` : null,
      company.industry ? `industry: ${company.industry}` : null,
      company.stage ? `stage: ${company.stage}` : null,
      company.headcountBand ? `size: ${company.headcountBand}` : null,
    ]
      .filter(Boolean)
      .join(' · ') || null,
    company.research ? `What you have written about the company:\n${company.research}` : null,
    role.jdExcerpt
      ? `Job description${role.jdTruncated ? ' (excerpt)' : ''}:\n${role.jdExcerpt}`
      : null,
    context.role.matches.length
      ? `Your record against the requirements:\n${renderMatches(context)}`
      : null,
    context.interviewers.length
      ? `Who you are meeting:\n\n${renderInterviewers(context)}`
      : null,
    context.priorRounds.length
      ? `Earlier rounds at this company:\n\n${renderPriorRounds(context)}`
      : null,
    context.profile.targetTitles.length
      ? `Roles they are looking for: ${context.profile.targetTitles.join(', ')}`
      : null,
    context.profile.writingStyleNotes
      ? `How they write:\n${context.profile.writingStyleNotes}`
      : null,
    // Named rather than left to be inferred from an absent section, so the
    // note can say it plainly instead of writing around it.
    context.missing.length
      ? `Not on file, so do not write as though it were:\n${context.missing
          .map((code) => `  - ${PREP_MISSING_LABEL[code]}`)
          .join('\n')}`
      : null,
  ]
    .filter(Boolean)
    .join('\n\n');
}

export async function writePrepNote(
  options: PrepOptions,
  input: PrepInput,
): Promise<PrepResult> {
  const { context } = input;

  // Nothing about the role and nothing about the record is not a thin note, it
  // is a note about an interview in the abstract. The match refuses an empty
  // bank for the same reason.
  if (context.role.matches.length === 0 && context.bank.length === 0 && !context.role.jdExcerpt) {
    return {
      ok: false,
      error:
        'There is no job description and nothing in your evidence bank, so there is nothing to prepare from yet.',
    };
  }

  const client = options.client ?? new Anthropic({ apiKey: options.apiKey });

  let response;
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 8192,
      // The bank is the same on every prep note the person ever generates, so
      // it sits behind a cache breakpoint and the round goes last, exactly as
      // in the match and the draft.
      system: [
        { type: 'text', text: SYSTEM },
        {
          type: 'text',
          text: context.bank.length
            ? `The evidence bank:\n\n${renderBank(context)}`
            : 'The evidence bank is empty. There are no stories to cite.',
          cache_control: { type: 'ephemeral' },
        },
      ],
      tools: [
        {
          name: TOOL_NAME,
          description: 'Report the prep note, section by section.',
          input_schema: {
            type: 'object',
            properties: {
              round_summary: { type: 'string' },
              interviewers: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    contact_id: { type: 'string' },
                    note: { type: 'string' },
                  },
                  required: ['contact_id', 'note'],
                },
              },
              points: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    requirement_index: { type: 'integer', minimum: 0 },
                    note: { type: 'string' },
                  },
                  required: ['requirement_index', 'note'],
                },
              },
              stories: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    evidence_item_id: { type: 'string' },
                    note: { type: 'string' },
                  },
                  required: ['evidence_item_id', 'note'],
                },
              },
              prior_rounds_note: { type: ['string', 'null'] },
              questions_to_ask: { type: 'array', items: { type: 'string' } },
              missing: { type: 'array', items: { type: 'string' } },
            },
            required: ['round_summary', 'questions_to_ask', 'missing'],
          },
        },
      ],
      tool_choice: { type: 'tool', name: TOOL_NAME },
      messages: [
        {
          role: 'user',
          content: `${renderContext(context)}\n\nCall ${TOOL_NAME}.`,
        },
      ],
    });
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) {
      return { ok: false, error: 'Prep is rate-limited right now.' };
    }
    if (error instanceof Anthropic.APIError) {
      return { ok: false, error: `Prep failed (${error.status}).` };
    }
    return { ok: false, error: error instanceof Error ? error.message : 'Prep failed.' };
  }
  options.onSpend?.({ model: MODEL, usage: usageFrom(response.usage) });

  const report = response.content.find(
    (block) => block.type === 'tool_use' && block.name === TOOL_NAME,
  );
  if (!report || report.type !== 'tool_use') {
    return { ok: false, error: 'No prep note came back.' };
  }

  return parsePrepPayload(report.input, context, input.banned ?? []);
}
