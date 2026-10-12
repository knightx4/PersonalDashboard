import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import { askJev } from '@/lib/jev/client';
import { decideWithJev } from '@/lib/jev/decide';
import { sampleFor } from '@/lib/learn/vault/classify-payload';
import { forceTool } from '@/lib/learn/graph/tool-call';
import {
  MAP_CLASS_QUESTION,
  MAP_EVIDENCE_QUESTION,
  mapClassState,
} from '@/lib/vault/map/jev-question';
import { mapClassifySchema, tooShortForMap, type MapVerdict } from '@/lib/vault/map/rules';
import { MODELS } from '@/lib/core/models';

/**
 * Stage 0 for the map: whether a note argues anything, in one cheap call.
 *
 * The same job as lib/learn/vault/classify.ts with the 75-note trial's two
 * fixes. There are three classes, and "evidence" is a flag beside them,
 * because a course summary or an application can evidence what somebody was
 * taught and still argue a position of their own. And the floor is 80
 * characters rather than 200. Only the title and the opening of the body are
 * sent; never the path.
 *
 * For an account that has opted in, and once VAULT_CLASS_ON_JEV is on, Jev
 * picks the class first (plan #1168). At 0.8 confidence or more its class
 * stands, a second Jev question sets the evidence flag, and no reason is
 * written. Under 0.8, or when a Jev call fails, Haiku classifies the note as
 * before and its reason is kept.
 */

const MODEL = MODELS.vaultMapClassify;
const TOOL_NAME = 'classify_note';

const SYSTEM = `You sort personal notes so that only the ones worth reading
closely are read closely.

knowledge: argues something. States what is true, why it works, what follows
from it, or what somebody should do and why. A book's argument written down, a
course boiled down to its takeaways, an opinion with reasons attached, or one
sentence stating a view plainly.

mixed: carries an argument inside something else. A note about a conversation
that also states a position. Application prose that argues a thesis. Meeting
notes where somebody's reasoning was written down.

operational: logistics and records with nothing argued. Travel plans, contact
details, meeting times, task lists, dated logs of measurements, drafts with
nothing stated yet.

Separately, say whether the note is evidence: it describes what a person has
done, studied or can do, such as coursework, a transcript, a CV or an
application. Evidence is not a class. A note can be evidence and knowledge at
once, and when it argues anything, choose knowledge or mixed.

Judge the prose in front of you rather than the title. Where a note sits
between two classes, choose the one that decides correctly what happens next:
knowledge and mixed are read, operational is not.

Give one short sentence of reason. It is shown to the person, who can disagree
with it.`;

export type MapHaikuAnswer = z.infer<typeof mapClassifySchema>;

/** Haiku's reading of a note: the class, the flag and a reason, or null when unreadable. */
export type MapHaiku = (input: {
  title: string;
  body: string;
  onSpend?: SpendSink;
}) => Promise<MapHaikuAnswer | null>;

/** The Haiku call, on its own so the Jev path and its tests can swap it. */
export function haikuForMap(client: Anthropic): MapHaiku {
  return async ({ title, body, onSpend }) => {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 300,
      system: SYSTEM,
      tools: [
        {
          name: TOOL_NAME,
          description: 'Say what kind of note this is.',
          input_schema: {
            type: 'object',
            properties: {
              class: { type: 'string', enum: ['knowledge', 'mixed', 'operational'] },
              is_evidence: { type: 'boolean' },
              reason: { type: 'string' },
            },
            required: ['class', 'is_evidence', 'reason'],
          },
        },
      ],
      tool_choice: forceTool(TOOL_NAME, MODEL),
      messages: [{ role: 'user', content: [`Title: ${title}`, '', sampleFor(body)].join('\n') }],
    });

    onSpend?.({ model: MODEL, usage: usageFrom(response.usage) });

    const block = response.content.find(
      (part) => part.type === 'tool_use' && part.name === TOOL_NAME,
    );
    const parsed =
      block && block.type === 'tool_use' ? mapClassifySchema.safeParse(block.input) : null;
    return parsed?.success ? parsed.data : null;
  };
}

export async function classifyForMap(input: {
  title: string;
  body: string;
  anthropicApiKey: string;
  client?: Anthropic;
  onSpend?: SpendSink;
  /** The account agreed to send note text to TypeSafe and the switch is on. */
  jevEnabled?: boolean;
  jevApiKey?: string | null;
  jevFetch?: typeof fetch;
  /** Tests hand in their own Haiku. */
  haiku?: MapHaiku;
}): Promise<MapVerdict> {
  if (tooShortForMap(input.body)) {
    return {
      noteClass: 'operational',
      isEvidence: false,
      reason: 'Too short to be stating anything.',
    };
  }

  const haiku =
    input.haiku ?? haikuForMap(input.client ?? new Anthropic({ apiKey: input.anthropicApiKey }));

  const byHaiku = async (): Promise<MapVerdict> => {
    const answer = await haiku({ title: input.title, body: input.body, onSpend: input.onSpend });
    // A failed call reads as operational. Wrongly skipping a note costs one
    // reading; wrongly reading one puts junk in front of the person.
    if (!answer) {
      return { noteClass: 'operational', isEvidence: false, reason: 'Could not be classified.' };
    }
    return { noteClass: answer.class, isEvidence: answer.is_evidence, reason: answer.reason };
  };

  const state = mapClassState(input);
  const jev = { onSpend: input.onSpend, apiKey: input.jevApiKey, fetch: input.jevFetch };

  type Gated =
    | { by: 'jev'; noteClass: MapVerdict['noteClass']; confidence: number }
    | { by: 'haiku'; verdict: MapVerdict };

  const decided = await decideWithJev<typeof MAP_CLASS_QUESTION, Gated>({
    ...jev,
    state,
    question: MAP_CLASS_QUESTION,
    enabled: input.jevEnabled ?? false,
    read: (answer) => ({ by: 'jev', noteClass: answer.choice, confidence: answer.confidence }),
    fallback: async () => ({ by: 'haiku', verdict: await byHaiku() }),
  });
  if (decided.value.by === 'haiku') return decided.value.verdict;

  // The flag changes nothing about whether the note is read, so Jev's lean
  // stands at any confidence. Only a failed call sends the note to Haiku.
  const evidence = await askJev({ ...jev, state, question: MAP_EVIDENCE_QUESTION });
  if (!evidence.ok) return byHaiku();

  return {
    noteClass: decided.value.noteClass,
    isEvidence: evidence.answer.yes,
    reason: null,
    confidence: decided.value.confidence,
  };
}
