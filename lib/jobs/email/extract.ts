import { z } from 'zod';
import type { MessageClassification } from './classify';
import { CLASSIFICATIONS } from './classify';

/**
 * Tier B: structured extraction from recruiting mail.
 *
 * Everything the model returns passes through the Zod schema before it can
 * touch the database, and then through the deterministic gates in
 * `applyExtraction`. Self-reported confidence is logged and used to sort the
 * review queue worst-first; it is never allowed to override a gate.
 *
 * There is no arithmetic check available here — the commerce app could always
 * ask whether the line items summed to the total. The substitutes are: the
 * company must be resolvable, the message must postdate the submission, the
 * implied transition must be legal, and any datetime must carry a timezone.
 */

export const PARSER_VERSION = 'recruiting-extract-v1';

/**
 * An interview time off by three hours is worse than no interview time at all,
 * so a datetime without a resolvable zone is rejected rather than assumed.
 */
const isoWithZone = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(Z|[+-]\d{2}:\d{2})$/,
    'datetime must carry an explicit UTC offset or Z',
  );

export const extractedMessageSchema = z.object({
  classification: z.enum(CLASSIFICATIONS),
  companyName: z.string().trim().min(1).nullable().optional(),
  roleTitle: z.string().trim().min(1).nullable().optional(),
  /** Greenhouse job id, Workday requisition, Lever posting id, … */
  atsJobId: z.string().trim().min(1).max(64).nullable().optional(),
  /** Interview or deadline times mentioned in the body. */
  dates: z
    .array(
      z.object({
        kind: z.enum(['interview', 'deadline', 'assessment_due', 'start_date', 'other']),
        at: isoWithZone,
        /** IANA zone when the mail named one; used only for display. */
        timezone: z.string().trim().min(1).nullable().optional(),
        label: z.string().trim().max(200).nullable().optional(),
      }),
    )
    .max(10)
    .default([]),
  interviewKind: z
    .enum(['recruiter_screen', 'hiring_manager', 'technical', 'case', 'panel', 'onsite', 'final', 'informal'])
    .nullable()
    .optional(),
  /** Names only. No other personal detail is extracted or stored. */
  interviewerNames: z.array(z.string().trim().min(1).max(120)).max(10).default([]),
  /** Does this message require the candidate to do something? */
  actionRequired: z.boolean().default(false),
  /** One line, for the timeline. Never the body. */
  summary: z.string().trim().min(1).max(200),
  confidence: z.number().min(0).max(1).default(0.5),
});

export type ExtractedMessage = z.infer<typeof extractedMessageSchema>;

export type GateFailure =
  | 'schema'
  | 'no_company'
  | 'predates_application'
  | 'illegal_transition'
  | 'datetime_without_zone';

export type ApplyExtractionResult =
  | { ok: true; extracted: ExtractedMessage }
  | { ok: false; reason: GateFailure; issues: string[] };

/** Parse and validate. Nothing reaches the database without passing here. */
export function applyExtraction(raw: unknown): ApplyExtractionResult {
  const parsed = extractedMessageSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      reason: parsed.error.issues.some((i) => i.message.includes('UTC offset'))
        ? 'datetime_without_zone'
        : 'schema',
      issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    };
  }
  return { ok: true, extracted: parsed.data };
}

export function buildSystemPrompt(): string {
  return `You extract structured facts from one recruiting email in a candidate's inbox.

Return ONLY a JSON object with these fields:
- classification: one of ${CLASSIFICATIONS.join(', ')}
- companyName: the EMPLOYER, never the ATS vendor. "Greenhouse", "Lever", "Workday",
  "Ashby", "iCIMS", "Calendly" are email infrastructure, not employers. If the only
  company you can see is the vendor, return null.
- roleTitle: the job title as written, or null
- atsJobId: a requisition or posting id if one appears (e.g. "4318822", "JR-284917"), else null
- dates: times mentioned, each {kind, at, timezone, label}. \`at\` MUST be a full ISO 8601
  timestamp with an explicit offset or Z. If the email gives a time with no zone and no
  zone can be inferred from the text, OMIT the date entirely. Do not guess a zone.
- interviewKind: recruiter_screen | hiring_manager | technical | case | panel | onsite | final | informal, or null
- interviewerNames: names of people named as interviewers. Names only.
- actionRequired: true when the candidate must do something (book a slot, submit work, reply)
- summary: ONE line describing what this email is, under 200 characters. No body text.
- confidence: 0 to 1

Classification rules:
- A rejection is a rejection however it is phrased. "We are moving forward with other
  candidates", "we are pausing the search", "we will keep your resume on file", "the
  position has been filled", "we decided to go in a different direction" are ALL rejections.
- An automated "we received your application" is application_confirmation, not recruiter_reply.
  This distinction decides whether the candidate's response rate is real, so be strict.
- A digest of many jobs from a board is job_alert, whatever else it mentions.
- Vendor marketing, newsletters, receipts and security mail are not_relevant.

Never invent a company, a role, or a time. Null is always better than a guess.`;
}

/**
 * Deterministic gates, applied after the schema.
 *
 * These are the substitute for the arithmetic check in the commerce app. Each
 * one can be evaluated without trusting the model at all.
 */
export function verifyExtraction(
  extracted: ExtractedMessage,
  context: {
    companyResolvable: boolean;
    receivedAt: Date | null;
    applicationSubmittedAt: Date | null;
    /** Whether the implied event may move status from where it is now. */
    transitionLegal: boolean;
  },
): { ok: true } | { ok: false; reason: GateFailure; detail: string } {
  if (!context.companyResolvable) {
    return {
      ok: false,
      reason: 'no_company',
      detail: 'No company could be resolved from the sender, the body, or the subject.',
    };
  }

  if (
    context.receivedAt &&
    context.applicationSubmittedAt &&
    context.receivedAt.getTime() < context.applicationSubmittedAt.getTime() - 24 * 60 * 60 * 1000
  ) {
    return {
      ok: false,
      reason: 'predates_application',
      detail: 'The message predates the application it would attach to.',
    };
  }

  if (!context.transitionLegal) {
    return {
      ok: false,
      reason: 'illegal_transition',
      detail:
        'The event was recorded but did not move the status, because the move would be backwards.',
    };
  }

  return { ok: true };
}

/** Classifications the model may return that are worth a timeline event. */
export function isActionable(classification: MessageClassification): boolean {
  return classification !== 'not_relevant' && classification !== 'job_alert';
}
