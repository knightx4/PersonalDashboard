/**
 * Dash's reply to a comment on a role (note 89ad8bef): what it is given to
 * read, and what is kept of its answer.
 *
 * Pure, so both halves are tested without a model. The call is in model.ts
 * and the round (load, ask, write) in ask.ts.
 *
 * Dash can do two things here. It answers in the thread, and when the comment
 * asks for a cover letter, or for a change to the one on file, it writes the
 * whole letter, which goes into the application's cover letter field. The
 * letter is drawn from the evidence bank the same way a drafted answer is
 * (lib/jobs/evidence/draft.ts), so the prompt names the bank items and asks
 * for the claims it could not ground.
 */
import type { MatchVerdict } from '@/lib/jobs/evidence/match-payload';
import type { RequirementKind } from '@/lib/jobs/jd/requirements';

/** The most of the description that goes in. The prep note uses the same. */
export const MAX_JD_CHARS = 12_000;
/** A company's research notes can run long; the reply needs the gist. */
export const MAX_RESEARCH_CHARS = 4_000;
/** The earlier turns of the thread that go in, newest kept. */
export const MAX_HISTORY = 20;
/** The column's own check (migration 0032). */
export const COVER_LETTER_MAX = 20_000;
/** Each earlier turn is cut to this, so one pasted page does not crowd out the rest. */
const MAX_TURN_CHARS = 2_000;

export type RoleReplyContext = {
  role: {
    title: string;
    seniority: string | null;
    location: string | null;
    workMode: string | null;
    jdText: string | null;
  };
  company: { name: string; industry: string | null; stage: string | null; research: string | null };
  application: { status: string; coverLetter: string | null };
  matches: ReadonlyArray<{
    requirement: string;
    kind: RequirementKind;
    verdict: MatchVerdict;
    evidenceItemId: string | null;
  }>;
  bank: ReadonlyArray<{
    id: string;
    title: string;
    body: string;
    context: string | null;
    metrics: string | null;
  }>;
  profile: { writingStyleNotes: string | null; banned: readonly string[] };
};

export type Turn = { author: 'me' | 'claude'; body: string };

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/**
 * The bank items by a short ref (e1, e2) rather than by uuid, so the model
 * has something it can copy without mangling. `refs` maps them back.
 */
export function renderBank(bank: RoleReplyContext['bank']): {
  text: string;
  refs: Map<string, string>;
} {
  const refs = new Map<string, string>();
  const blocks = bank.map((item, index) => {
    const ref = `e${index + 1}`;
    refs.set(ref, item.id);
    return [
      `[${ref}] ${item.title}`,
      item.body,
      item.context ? `Context: ${item.context}` : null,
      item.metrics ? `Numbers: ${item.metrics}` : null,
    ]
      .filter(Boolean)
      .join('\n');
  });
  return { text: blocks.join('\n\n---\n\n'), refs };
}

/** The role, the thread and the comment, as one message. */
export function roleReplyMessage(
  context: RoleReplyContext,
  history: readonly Turn[],
  question: string,
  refs: ReadonlyMap<string, string>,
): string {
  const { role, company, application, profile } = context;
  const refOf = new Map([...refs].map(([ref, id]) => [id, ref]));

  const matches = context.matches.map((match) => {
    const cited = match.evidenceItemId ? refOf.get(match.evidenceItemId) : undefined;
    return `- (${match.kind.replace(/_/g, ' ')}, ${match.verdict}${cited ? `, ${cited}` : ''}) ${match.requirement}`;
  });

  const turns = history
    .slice(-MAX_HISTORY)
    .map(
      (turn) =>
        `${turn.author === 'me' ? 'Them' : 'Dash'}: ${clip(turn.body.trim(), MAX_TURN_CHARS)}`,
    );

  return [
    `Role: ${role.title} at ${company.name}`,
    [
      role.seniority ? `Seniority: ${role.seniority}` : null,
      role.location ? `Location: ${role.location}` : null,
      role.workMode ? `Work mode: ${role.workMode}` : null,
      `Application status: ${application.status.replace(/_/g, ' ')}`,
    ]
      .filter(Boolean)
      .join('\n'),
    [
      company.industry ? `Industry: ${company.industry}` : null,
      company.stage ? `Stage: ${company.stage}` : null,
    ]
      .filter(Boolean)
      .join('\n') || null,
    company.research?.trim()
      ? `What they have written about the company:\n${clip(company.research.trim(), MAX_RESEARCH_CHARS)}`
      : null,
    role.jdText?.trim()
      ? `Job description:\n${clip(role.jdText.trim(), MAX_JD_CHARS)}`
      : 'There is no job description on file.',
    matches.length
      ? `Their record against the requirements (kind, verdict, the bank item that answers it):\n${matches.join('\n')}`
      : null,
    application.coverLetter?.trim()
      ? `The cover letter on file now:\n${application.coverLetter.trim()}`
      : 'There is no cover letter on file.',
    profile.writingStyleNotes?.trim()
      ? `How they write:\n${profile.writingStyleNotes.trim()}`
      : null,
    profile.banned.length ? `Never use these: ${profile.banned.join('; ')}` : null,
    turns.length ? `The thread on this role so far:\n${turns.join('\n\n')}` : null,
    `Their comment:\n${question}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

export type RoleReply =
  | { kind: 'error'; error: string }
  | {
      kind: 'reply';
      /** What goes in the thread. */
      answer: string;
      /** The whole new letter, or null when the comment did not ask for one. */
      coverLetter: string | null;
      /** Bank items the letter draws on, as uuids. */
      evidenceItemIds: string[];
      /** Claims in the letter no bank item carries, to check before sending. */
      unsupportedClaims: string[];
    };

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(text).filter(Boolean) : [];
}

/**
 * What is kept of the tool input. A letter with a banned construction in it
 * is refused rather than filed, because it would go out under their name.
 */
export function parseRoleReply(
  input: unknown,
  refs: ReadonlyMap<string, string>,
  banned: readonly string[],
): RoleReply {
  if (!input || typeof input !== 'object') return { kind: 'error', error: 'No reply came back.' };
  const raw = input as Record<string, unknown>;

  const answer = text(raw.answer);
  const coverLetter = text(raw.cover_letter) || null;
  if (!answer && !coverLetter) return { kind: 'error', error: 'The reply came back empty.' };

  if (coverLetter) {
    if (coverLetter.length > COVER_LETTER_MAX) {
      return { kind: 'error', error: 'The letter came back longer than the field holds.' };
    }
    const lower = coverLetter.toLowerCase();
    const hit = banned.find(
      (phrase) => phrase.trim() && lower.includes(phrase.trim().toLowerCase()),
    );
    if (hit) {
      return {
        kind: 'error',
        error: `The letter used "${hit}", which you have ruled out, so it was not filed.`,
      };
    }
  }

  const evidenceItemIds = coverLetter
    ? [
        ...new Set(
          strings(raw.evidence_refs)
            .map((ref) => refs.get(ref))
            .filter((id): id is string => !!id),
        ),
      ]
    : [];
  const unsupportedClaims = coverLetter ? strings(raw.unsupported_claims) : [];

  return { kind: 'reply', answer, coverLetter, evidenceItemIds, unsupportedClaims };
}

/**
 * What Dash writes in the thread. When it filed a letter it says so, lists
 * what to check, and keeps the letter it replaced, so writing over one you
 * had edited by hand loses nothing.
 */
export function replyBody(
  reply: Extract<RoleReply, { kind: 'reply' }>,
  replaced: string | null,
): string {
  if (!reply.coverLetter) return reply.answer;

  const parts = [
    reply.answer ||
      (replaced
        ? 'I rewrote the cover letter. It is under Application.'
        : 'I wrote a cover letter. It is under Application.'),
  ];
  if (reply.unsupportedClaims.length) {
    parts.push(
      `Check these before you send it, since nothing in your evidence bank carries them:\n${reply.unsupportedClaims
        .map((claim) => `- ${claim}`)
        .join('\n')}`,
    );
  }
  if (replaced?.trim() && replaced.trim() !== reply.coverLetter) {
    parts.push(`The letter it replaced:\n\n${replaced.trim()}`);
  }
  return parts.join('\n\n');
}
