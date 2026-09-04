import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { applyExtraction, buildSystemPrompt, PARSER_VERSION, type ExtractedMessage } from '@/lib/jobs/email/extract';
import type { ClassifyResult } from '@/lib/jobs/email/classify';

/**
 * Tier B: the model pass, for anything Tier A could not place confidently.
 *
 * Cheap model, small context, strict schema. The body is sent and never stored
 * — provider-side retention is disabled where the API allows it, and nothing
 * here logs the text it sends.
 */

const MAX_BODY_CHARS = 6_000;

export interface TierBResult {
  extracted: ExtractedMessage | null;
  parserVersion: string;
  error?: string;
}

export async function extractWithModel(input: {
  subject: string | null;
  fromAddress: string | null;
  replyToAddress: string | null;
  body: string;
  tierA: ClassifyResult;
  apiKey?: string | null;
}): Promise<TierBResult> {
  const apiKey = input.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { extracted: null, parserVersion: PARSER_VERSION, error: 'no_api_key' };
  }

  try {
    const client = new Anthropic({ apiKey });
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1200,
      system: buildSystemPrompt(),
      messages: [
        {
          role: 'user',
          content: [
            `From: ${input.fromAddress ?? 'unknown'}`,
            `Reply-To: ${input.replyToAddress ?? 'none'}`,
            `Subject: ${input.subject ?? '(no subject)'}`,
            '',
            'Body:',
            input.body.slice(0, MAX_BODY_CHARS),
          ].join('\n'),
        },
      ],
    });

    const block = message.content.find((b) => b.type === 'text');
    const text = block && block.type === 'text' ? block.text : '';
    const json = text.match(/\{[\s\S]*\}/);
    if (!json) {
      return { extracted: null, parserVersion: PARSER_VERSION, error: 'no_json' };
    }

    const applied = applyExtraction(JSON.parse(json[0]));
    if (!applied.ok) {
      // Never log the issues verbatim alongside the body; the reason is enough.
      return { extracted: null, parserVersion: PARSER_VERSION, error: applied.reason };
    }
    return { extracted: applied.extracted, parserVersion: PARSER_VERSION };
  } catch (error) {
    // Deliberately does not log the error object: the SDK attaches the request
    // payload, which is the email body.
    console.error('tier B extraction failed', {
      name: error instanceof Error ? error.name : 'unknown',
    });
    return { extracted: null, parserVersion: PARSER_VERSION, error: 'model_error' };
  }
}

/**
 * When Tier A was confident, its label wins over the model's. Tier A is
 * deterministic; the model is a guess with better recall on shape but no
 * knowledge of which domains are ATS infrastructure.
 *
 * One exception, and it is the pair the whole classifier is ordered around: a
 * rejection read as an acknowledgement. Tier A sees only the first 2000
 * characters and only the euphemisms someone thought to write down, while
 * every rejection opens with the same sentence an acknowledgement does —
 * "thank you for your interest in <company>". When the wording that would have
 * settled it sits below the preview window, Tier A returns
 * application_confirmation with full confidence and the model's correct
 * reading is discarded. That is the most expensive mistake this pipeline can
 * make: the pursuit is created in the funnel as live, no rejection event is
 * ever written, and nothing later says otherwise.
 *
 * Narrow on purpose. Only this one substitution is allowed, and only in this
 * direction — the model does not get to overrule a deterministic label in
 * general, and a rejection it invents about mail Tier A read as an interview
 * invite would close a live pursuit, which is the mirror-image error.
 */
export function reconcileClassification(
  tierA: ClassifyResult,
  extracted: ExtractedMessage | null,
): ExtractedMessage['classification'] {
  if (
    extracted?.classification === 'rejection' &&
    tierA.classification === 'application_confirmation'
  ) {
    return 'rejection';
  }
  if (tierA.tier === 'A' && tierA.classification !== 'not_relevant') {
    return tierA.classification;
  }
  return extracted?.classification ?? tierA.classification;
}
