import { displayNameFromAddress } from '@/lib/email/extract/heuristic';
import { bareAddress, gmailOpenUrl } from '@/lib/email/gmail-open';

/**
 * The Todo task for an email that is waiting on the person's answer
 * (plan #1180). Pure, so the wording and the guards are tested without a
 * database.
 */

/** How far back a reply task is still worth filing. Older mail is left alone. */
export const REPLY_WINDOW_DAYS = 14;

/** Senders nobody replies to, whatever Jev made of the subject. */
const AUTOMATED_SENDER =
  /^(?:no-?reply|do-?not-?reply|donotreply|notifications?|notify|alerts?|mailer-daemon|postmaster|bounces?|automated|system)\b/i;

export type ReplyCandidate = {
  message_id: string;
  account_email: string | null;
  thread_id: string;
  received_at: string | null;
  from_address: string | null;
  reply_to_address: string | null;
  subject: string | null;
};

/**
 * Why no task is filed for a thread, or null when one is. An automated
 * sender, or mail the person sent themselves, is judged once and left.
 */
export function skipReason(candidate: ReplyCandidate): 'automated' | 'own' | null {
  const from = bareAddress(candidate.from_address)?.toLowerCase() ?? null;
  const replyTo = bareAddress(candidate.reply_to_address)?.toLowerCase() ?? null;
  const own = candidate.account_email?.toLowerCase() ?? null;
  if (from && own && from === own) return 'own';
  const local = (replyTo ?? from)?.split('@')[0] ?? '';
  if (AUTOMATED_SENDER.test(local)) return 'automated';
  return null;
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

export function replyTaskTitle(candidate: ReplyCandidate): string {
  const who =
    displayNameFromAddress(candidate.from_address) ??
    bareAddress(candidate.from_address) ??
    'someone';
  const subject = (candidate.subject ?? '').replace(/^(?:\s*(?:re|fwd?):\s*)+/i, '').trim();
  return clip(subject ? `Reply to ${who}: ${subject}` : `Reply to ${who}`, 200);
}

export function replyTaskBody(candidate: ReplyCandidate): string {
  const link = gmailOpenUrl({ emailAddress: candidate.account_email, threadId: candidate.thread_id });
  const lines = ['Dash sorted this email as waiting on your answer.'];
  if (link) lines.push('', `[Open in Gmail](${link})`);
  return lines.join('\n');
}
