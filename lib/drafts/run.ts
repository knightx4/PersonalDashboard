import type { SpendReport } from '@/lib/core/spend/pricing';
import {
  checkDraft,
  draftExpiry,
  draftReason,
  MAX_NEW_PER_DAY,
  type DraftKind,
  type FollowUpCandidate,
  type ReturnCandidate,
} from './find';
import { plainDraft, type DraftContext } from './write';

/**
 * One person's drafts for the morning (plan #1129): find what is due, skip
 * what was already drafted for the same quiet stretch or return window, and
 * write at most MAX_NEW_PER_DAY of each kind a day. Each is written by the
 * model when there is one to ask and by the plain template otherwise, and
 * stored to show on the agenda from today for three days.
 *
 * Runs in the hourly day-brief tick just before the brief, so what it writes
 * is on the agenda the brief reads.
 */

type Candidate = FollowUpCandidate | ReturnCandidate;

export type DraftRow = {
  user_id: string;
  kind: DraftKind;
  about_id: string;
  basis: string;
  about_label: string;
  to_address: string | null;
  from_inbox: string | null;
  subject: string;
  body: string;
  reason: string;
  model: string | null;
  show_on: string;
  expires_at: string;
};

export type Addressing = {
  context: Omit<DraftContext, 'candidate' | 'today' | 'senderName'>;
  toAddress: string | null;
  fromInbox: string | null;
};

export type DraftPorts = {
  /** Which kinds this person should get: the agenda source is on, the workspace is on. */
  kinds(userId: string): Promise<DraftKind[]>;
  followUps(userId: string, now: Date): Promise<FollowUpCandidate[]>;
  returns(userId: string, today: string): Promise<ReturnCandidate[]>;
  /** `kind:about_id:basis` for every draft already stored for these ids. */
  drafted(userId: string, aboutIds: string[]): Promise<Set<string>>;
  /** How many drafts of each kind were already written to show today. */
  writtenToday(userId: string, today: string): Promise<Record<DraftKind, number>>;
  /** The thread, the events and who to write to. */
  addressing(userId: string, candidate: Candidate): Promise<Addressing>;
  senderName(userId: string): Promise<string | null>;
  /** The model's draft, unchecked; null when there is no model to ask. */
  write(
    context: DraftContext,
    onSpend: (report: SpendReport) => void,
  ): Promise<{ model: string; draft: { subject: string; body: string } | null } | null>;
  ledger(userId: string, report: SpendReport): Promise<void>;
  /** Stores the row; false when the same draft was already there. */
  save(row: DraftRow): Promise<boolean>;
};

export type DraftsResult = { written: number; considered: number };

export function draftKey(kind: string, aboutId: string, basis: string): string {
  return `${kind}:${aboutId}:${basis}`;
}

function labelOf(candidate: Candidate): string {
  return candidate.kind === 'follow_up' ? candidate.companyName : candidate.merchantName;
}

export async function runDraftsFor(
  ports: DraftPorts,
  person: { userId: string; today: string },
  now: Date,
): Promise<DraftsResult> {
  const kinds = await ports.kinds(person.userId);
  if (kinds.length === 0) return { written: 0, considered: 0 };

  const [followUps, returns] = await Promise.all([
    kinds.includes('follow_up') ? ports.followUps(person.userId, now) : Promise.resolve([]),
    kinds.includes('return_request')
      ? ports.returns(person.userId, person.today)
      : Promise.resolve([]),
  ]);
  const candidates: Candidate[] = [...returns, ...followUps];
  if (candidates.length === 0) return { written: 0, considered: 0 };

  const [drafted, today] = await Promise.all([
    ports.drafted(person.userId, [...new Set(candidates.map((c) => c.aboutId))]),
    ports.writtenToday(person.userId, person.today),
  ]);

  const room: Record<DraftKind, number> = {
    follow_up: Math.max(0, MAX_NEW_PER_DAY - today.follow_up),
    return_request: Math.max(0, MAX_NEW_PER_DAY - today.return_request),
  };
  const chosen: Candidate[] = [];
  for (const candidate of candidates) {
    if (drafted.has(draftKey(candidate.kind, candidate.aboutId, candidate.basis))) continue;
    if (room[candidate.kind] <= 0) continue;
    room[candidate.kind] -= 1;
    chosen.push(candidate);
  }
  if (chosen.length === 0) return { written: 0, considered: candidates.length };

  const senderName = await ports.senderName(person.userId);

  // Side by side, since the tick has a time limit: at most six a morning,
  // and a failure costs its own draft and nothing else.
  const saved = await Promise.all(
    chosen.map(async (candidate): Promise<boolean> => {
      try {
        const addressing = await ports.addressing(person.userId, candidate);
        const context: DraftContext = {
          ...addressing.context,
          candidate,
          senderName,
          today: person.today,
        };

        let draft: { subject: string; body: string } | null = null;
        let model: string | null = null;
        const reports: SpendReport[] = [];
        try {
          const reply = await ports.write(context, (report) => reports.push(report));
          const checked = reply?.draft ? checkDraft(reply.draft) : null;
          if (reply && checked) {
            draft = checked;
            model = reply.model;
          }
        } catch {
          // The plain draft below stands in; the failure costs the prose, not the draft.
        } finally {
          for (const report of reports) await ports.ledger(person.userId, report);
        }
        draft ??= checkDraft(plainDraft(context));
        if (!draft) return false;

        return await ports.save({
          user_id: person.userId,
          kind: candidate.kind,
          about_id: candidate.aboutId,
          basis: candidate.basis,
          about_label: labelOf(candidate),
          to_address: addressing.toAddress,
          from_inbox: addressing.fromInbox,
          subject: draft.subject,
          body: draft.body,
          reason: draftReason(candidate),
          model,
          show_on: person.today,
          expires_at: draftExpiry(now),
        });
      } catch {
        // The others are still written; this one is tried again next hour.
        return false;
      }
    }),
  );

  return { written: saved.filter(Boolean).length, considered: candidates.length };
}
