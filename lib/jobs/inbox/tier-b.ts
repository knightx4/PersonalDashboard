import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import { decideWithJev } from '@/lib/jev/decide';
import { applyExtraction, buildSystemPrompt, PARSER_VERSION, type ExtractedMessage } from '@/lib/jobs/email/extract';
import type { ClassifyResult, MessageClassification } from '@/lib/jobs/email/classify';
import {
  isJobEmailLabel,
  JEV_UNTRUSTED_LABELS,
  JOB_EMAIL_QUESTION,
  jobEmailState,
} from '@/lib/jobs/email/jev-question';
import { MODELS } from '@/lib/core/models';

/**
 * Tier B: the model pass, for anything Tier A could not place confidently.
 *
 * Cheap model, small context, strict schema. The body is sent and never stored
 * — provider-side retention is disabled where the API allows it, and nothing
 * here logs the text it sends.
 */

const MAX_BODY_CHARS = 6_000;
const TIER_B_MODEL = MODELS.jobsInboxTierB;

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
  /** What the call cost; record it as 'classify-job-email'. */
  onSpend?: SpendSink;
}): Promise<TierBResult> {
  const apiKey = input.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { extracted: null, parserVersion: PARSER_VERSION, error: 'no_api_key' };
  }

  try {
    const client = new Anthropic({ apiKey });
    const message = await client.messages.create({
      model: TIER_B_MODEL,
      max_tokens: 4_000, // room for Haiku 5.5's thinking as well as the answer
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

    input.onSpend?.({ model: TIER_B_MODEL, usage: usageFrom(message.usage) });

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
 * Where the ingest stops after the label: nothing is linked or written beyond
 * the ledger's verdict, so no fact Haiku could extract would be used.
 */
export const LABEL_ENDS_INGEST: ReadonlySet<MessageClassification> = new Set(['not_relevant', 'job_alert']);

export type TriageResult = TierBResult & {
  /**
   * Who settled the label reconcileClassification sees: Jev when it was sure
   * of a label it is trusted with, otherwise Haiku. `extracted.confidence` is
   * that model's, so the ledger's parse_confidence is Jev's calibrated value
   * whenever Jev settled it.
   */
  labelBy: 'jev' | 'haiku';
};

type ExtractInput = Parameters<typeof extractWithModel>[0];

/** What deciding the label gives back: Jev's label, or the whole Haiku call. */
type Labelled =
  | { by: 'jev'; label: MessageClassification; confidence: number }
  | { by: 'haiku'; result: TierBResult };

/**
 * Tier B with Jev in front (plan #1166): Jev picks the label, Haiku reads the
 * facts.
 *
 * 1. Jev is asked which of the eleven classifications the message is, unless
 *    the account has not agreed to send its text to TypeSafe (`jevEnabled`,
 *    from lib/jev/enabled.ts), in which case nothing is sent.
 * 2. Its answer stands at 0.8 confidence or more, except `recruiter_reply`,
 *    `offer` and `other`, which Haiku decides whatever Jev says
 *    (JEV_UNTRUSTED_LABELS). Otherwise, or when Jev fails, this is the Haiku
 *    call it always was, and Haiku's label is used.
 * 3. When Jev's label stands, Haiku still runs if the message goes on into
 *    the pipeline, because only Haiku returns the company, role, dates and
 *    interviewers the linker needs. Jev's label replaces Haiku's. The Haiku
 *    call is saved only where the label ends the ingest (LABEL_ENDS_INGEST).
 *
 * Tier A's authority is unchanged: the caller still passes the result through
 * reconcileClassification, so a confident rule beats Jev as it beat Haiku,
 * with the one rejection exception. Jev's spend goes to the same `onSpend`
 * as Haiku's, and so to `classify-job-email`.
 */
export async function triageWithModels(
  input: ExtractInput & {
    /** False for an account that has not opted in; Jev is then never called. */
    jevEnabled: boolean;
    jevApiKey?: string | null;
    jevFetch?: typeof fetch;
    /** Haiku's extraction; replaced in tests. */
    extract?: (input: ExtractInput) => Promise<TierBResult>;
  },
): Promise<TriageResult> {
  const extract = input.extract ?? extractWithModel;
  const haiku = () =>
    extract({
      subject: input.subject,
      fromAddress: input.fromAddress,
      replyToAddress: input.replyToAddress,
      body: input.body,
      tierA: input.tierA,
      apiKey: input.apiKey,
      onSpend: input.onSpend,
    });

  const decided = await decideWithJev<typeof JOB_EMAIL_QUESTION, Labelled>({
    state: jobEmailState(input),
    question: JOB_EMAIL_QUESTION,
    enabled: input.jevEnabled,
    trust: (answer) => isJobEmailLabel(answer.choice) && !JEV_UNTRUSTED_LABELS.has(answer.choice),
    read: (answer) => ({
      by: 'jev',
      // `trust` has already turned away `other`, the one option that is not a classification.
      label: answer.choice as MessageClassification,
      confidence: answer.confidence,
    }),
    fallback: async () => ({ by: 'haiku', result: await haiku() }),
    onSpend: input.onSpend,
    apiKey: input.jevApiKey,
    fetch: input.jevFetch,
  });

  if (decided.value.by === 'haiku') return { ...decided.value.result, labelBy: 'haiku' };

  const { label, confidence } = decided.value;
  const labelled: ExtractedMessage = {
    classification: label,
    dates: [],
    interviewerNames: [],
    actionRequired: false,
    summary: 'The details of this email could not be read.',
    confidence,
  };

  if (LABEL_ENDS_INGEST.has(reconcileClassification(input.tierA, labelled))) {
    return { extracted: labelled, parserVersion: PARSER_VERSION, labelBy: 'jev' };
  }

  const facts = await haiku();
  return {
    ...facts,
    // A failed extraction still leaves Jev's label, which is better than the
    // guess Tier A fell back to before.
    extracted: facts.extracted ? { ...facts.extracted, classification: label, confidence } : labelled,
    labelBy: 'jev',
  };
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
