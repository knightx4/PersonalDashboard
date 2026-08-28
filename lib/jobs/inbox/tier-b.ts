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
 */
export function reconcileClassification(
  tierA: ClassifyResult,
  extracted: ExtractedMessage | null,
): ExtractedMessage['classification'] {
  if (tierA.tier === 'A' && tierA.classification !== 'not_relevant') {
    return tierA.classification;
  }
  return extracted?.classification ?? tierA.classification;
}
