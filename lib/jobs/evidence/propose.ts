/**
 * Evidence candidates, read out of material you have already written.
 *
 * The bank is the quality ceiling of everything the writing layer will ever
 * produce, and the only way into it is a six-field form that takes one item at
 * a time. Nobody sits down and does that twenty times, so the bank stays empty
 * and every feature built on top of it is worth zero.
 *
 * The material is already in the account, though: a pasted resume, the
 * behavioural answers you have approved, the debriefs you wrote after
 * interviews. Each of those is a story in your own words that only needs
 * splitting up and tagging. This proposes the split. It does not write it —
 * nothing here reaches `evidence_items` without a click, the same rule the
 * shelf-photo and receipt flows follow on the commerce side, and it matters
 * more here because a bad item silently poisons every match downstream.
 */
import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import {
  MAX_CANDIDATES,
  parseEvidenceProposalPayload,
  type EvidenceProposalResult,
  type EvidenceSourceKind,
} from './propose-payload';

/**
 * Judgment, not retrieval: deciding what counts as a story and what is a
 * skill claim in a bullet's clothing is the whole job. Haiku is the house
 * default for lookups; this is not a lookup.
 */
const MODEL = 'claude-opus-5';
const TOOL_NAME = 'propose_evidence';

const SOURCE_GUIDANCE: Record<EvidenceSourceKind, string> = {
  resume:
    'This is a resume. Each accomplishment bullet is a candidate story, but a ' +
    'bullet is compressed to the point of being unreadable as a story — expand ' +
    'it into the situation, the action and the outcome using only what the ' +
    'bullet and its surrounding role actually say. Skill lists, education, ' +
    'tools and job titles on their own are not stories; skip them.',
  answers:
    'These are application answers the person wrote and approved. A behavioural ' +
    'answer already is a story — lift it close to verbatim, in their words, and ' +
    'give it a handle. Answers about motivation ("why this company") are about ' +
    'the employer, not about the person; skip those.',
  debriefs:
    'These are notes written after interviews. Take the things the person did ' +
    'or built that they were describing, not their commentary on how the ' +
    'interview went and not the interviewer\'s questions.',
};

const SYSTEM = `You read someone's own writing about their career and pull out the
stories worth keeping in an evidence bank — the bank a job-search assistant
later cites when it drafts application answers.

An evidence item is one concrete thing this person did. It has a situation, an
action they took, and an outcome. "Rebuilt the close process" is an item.
"Strong communicator" is not. "Proficient in Python" is not. A list of
responsibilities is not — it says what the job was, not what they did.

For each item you find, report:
- title: a short handle, the way they would refer to it in conversation.
  "Rebuilt the close process", not "Process Improvement Initiative".
- body: the story, two to five sentences, in their voice and their vocabulary.
  Use only what the source says. Do not invent a scale, a team size, a
  timeline, or a result that is not there. If the source is thin, the body is
  thin — that is the correct outcome, not a reason to embellish.
- context: where and when, if the source says. "Acme, 2024". Null if not.
- metrics: the number, if the source has one, as they stated it. Null if not.
  Never round a number up and never supply one that is absent.
- skills: two to five lowercase tags for what the story demonstrates.
- strength: 1 to 5, how well this stands on its own as proof. A story with a
  concrete outcome and a number is a 5. A story with an action and no result
  is a 2 or 3.

Prefer fewer, better items. Ten real stories beat thirty padded ones, and every
item you propose is one the person has to read and judge. Report at most
${MAX_CANDIDATES}. Do not repeat the same story under two titles.

If the source contains nothing that reads as a story — it is a skills list, or
a stub, or a page of boilerplate — set no_data true and propose nothing rather
than manufacturing items to fill the list.`;

export type ProposeEvidenceInput = {
  kind: EvidenceSourceKind;
  /** The source material, already assembled and trimmed by the caller. */
  text: string;
  /** Titles already in the bank, so the model does not re-propose them. */
  existingTitles?: readonly string[];
};

export type ProposeEvidenceOptions = {
  apiKey: string;
  /** Overridable for tests. */
  client?: Anthropic;
};

export async function proposeEvidenceFromSource(
  options: ProposeEvidenceOptions,
  input: ProposeEvidenceInput,
): Promise<EvidenceProposalResult> {
  const client = options.client ?? new Anthropic({ apiKey: options.apiKey });

  const already = (input.existingTitles ?? []).slice(0, 60);
  const avoid = already.length
    ? `\n\nAlready in the bank, so do not propose them again:\n${already
        .map((title) => `- ${title}`)
        .join('\n')}`
    : '';

  let response;
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 8192,
      system: SYSTEM,
      tools: [
        {
          name: TOOL_NAME,
          description: 'Report the evidence items found in the source material.',
          input_schema: {
            type: 'object',
            properties: {
              candidates: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    title: { type: 'string' },
                    body: { type: 'string' },
                    context: { type: ['string', 'null'] },
                    metrics: { type: ['string', 'null'] },
                    skills: { type: 'array', items: { type: 'string' } },
                    strength: { type: 'integer', minimum: 1, maximum: 5 },
                  },
                  required: ['title', 'body'],
                },
              },
              no_data: { type: 'boolean' },
            },
            required: ['no_data'],
          },
        },
      ],
      tool_choice: { type: 'tool', name: TOOL_NAME },
      messages: [
        {
          role: 'user',
          content: `${SOURCE_GUIDANCE[input.kind]}${avoid}\n\n---\n\n${input.text}\n\n---\n\nCall ${TOOL_NAME}.`,
        },
      ],
    });
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) {
      return { ok: false, error: 'Evidence proposals are rate-limited right now.' };
    }
    if (error instanceof Anthropic.APIError) {
      return { ok: false, error: `Proposal failed (${error.status}).` };
    }
    return { ok: false, error: error instanceof Error ? error.message : 'Proposal failed.' };
  }

  const report = response.content.find(
    (block) => block.type === 'tool_use' && block.name === TOOL_NAME,
  );
  if (!report || report.type !== 'tool_use') {
    return { ok: false, error: 'No proposal came back.' };
  }

  return parseEvidenceProposalPayload(report.input);
}
