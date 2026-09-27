import { addressOnly, composeFollowUp, displayName, firstName } from '@/lib/jobs/followup/compose';
import { isNoReply, type FollowUpCandidate, type ReturnCandidate } from './find';

/**
 * What the model is given to write a draft from, and the plain message
 * stored when there is no model to ask (plan #1129).
 *
 * The thread is what the app keeps of the mail about the application or
 * order: who wrote, when, and the subject line, with the pipeline's own
 * one-line summary of each event. Bodies are not kept after ingest, so the
 * model writes from those lines and the record, not from the text of the
 * emails.
 *
 * Pure, so the prompt and the fallback are tested without a model.
 */

export type ThreadLine = {
  at: string;
  from: string | null;
  subject: string | null;
};

export type DraftContext = {
  candidate: FollowUpCandidate | ReturnCandidate;
  /** Newest first. */
  thread: readonly ThreadLine[];
  /** The pipeline's events on an application, newest first; empty for an order. */
  events: readonly { at: string; kind: string; summary: string | null }[];
  /** The display name of whoever the draft is addressed to, when known. */
  recipientName: string | null;
  /** The person's own name, for the sign-off. */
  senderName: string | null;
  today: string;
};

function day(iso: string): string {
  return iso.slice(0, 10);
}

function money(cents: number | null): string | null {
  return cents == null ? null : `${(cents / 100).toFixed(2)}`;
}

/** The user turn: the facts under headings, one per line. */
export function draftPrompt(context: DraftContext): string {
  const { candidate } = context;
  const lines = [`Today is ${context.today}.`, ''];

  if (candidate.kind === 'follow_up') {
    lines.push(
      'Write a follow-up on a job application that has gone quiet.',
      `Company: ${candidate.companyName}`,
      `Role: ${candidate.roleTitle ?? 'not recorded'}`,
      `Applied: ${candidate.submittedAt ? day(candidate.submittedAt) : 'date not recorded'}`,
      `Last word from them: ${day(candidate.basis)} (${candidate.quietDays} days ago)`,
    );
  } else {
    lines.push(
      'Write a request to return items from an online order before the return window closes.',
      `Shop: ${candidate.merchantName}`,
      `Order number: ${candidate.externalOrderNumber ?? 'not recorded'}`,
      `Ordered: ${candidate.orderDate ?? 'date not recorded'}`,
      `Return window closes: ${candidate.deadline}`,
      'Items to return:',
      ...candidate.items.map((item) => {
        const price = money(item.costCents);
        return `- ${item.name}${item.variant ? ` (${item.variant})` : ''}${price ? `, ${price}` : ''}`;
      }),
    );
  }

  lines.push(
    '',
    `Writing to: ${context.recipientName ?? 'no name known; open with a plain greeting'}`,
    `Sign off as: ${context.senderName ?? 'no name known; end without a name'}`,
  );

  if (context.events.length > 0) {
    lines.push('', 'What has happened so far, newest first:');
    for (const event of context.events.slice(0, 8)) {
      lines.push(
        `- ${day(event.at)} ${event.kind.replace(/_/g, ' ')}${event.summary ? `: ${event.summary}` : ''}`,
      );
    }
  }

  if (context.thread.length > 0) {
    lines.push('', 'Mail about it, newest first (date, sender, subject):');
    for (const message of context.thread.slice(0, 8)) {
      lines.push(
        `- ${day(message.at)} | ${message.from ?? 'unknown sender'} | ${message.subject ?? '(no subject)'}`,
      );
    }
  }

  return lines.join('\n');
}

/** The follow-up without a model: the template in lib/jobs/followup/compose.ts. */
function plainFollowUp(context: DraftContext, candidate: FollowUpCandidate) {
  return composeFollowUp({
    companyName: candidate.companyName,
    roleTitle: candidate.roleTitle,
    appliedAt: candidate.submittedAt,
    recipientName: context.recipientName,
    senderName: context.senderName,
    now: new Date(`${context.today}T12:00:00Z`),
  });
}

function plainReturn(context: DraftContext, candidate: ReturnCandidate) {
  const greeting = firstName(context.recipientName);
  const order = candidate.externalOrderNumber
    ? `order #${candidate.externalOrderNumber}`
    : 'my recent order';
  const items = candidate.items.map(
    (item) => `- ${item.name}${item.variant ? ` (${item.variant})` : ''}`,
  );
  const lines = [
    greeting ? `Hi ${greeting},` : 'Hello,',
    '',
    `I would like to return the following from ${order}${candidate.orderDate ? `, placed on ${candidate.orderDate}` : ''}:`,
    '',
    ...items,
    '',
    `The return window closes on ${candidate.deadline}. Could you send a return label or tell me how to start the return?`,
    '',
    'Thank you.',
    '',
    context.senderName?.trim() || '',
  ];
  return {
    subject: candidate.externalOrderNumber
      ? `Return request for order #${candidate.externalOrderNumber}`
      : `Return request for my order from ${candidate.merchantName}`,
    body: lines.join('\n').trim(),
  };
}

export function plainDraft(context: DraftContext): { subject: string; body: string } {
  return context.candidate.kind === 'follow_up'
    ? plainFollowUp(context, context.candidate)
    : plainReturn(context, context.candidate);
}

export type MessageRow = {
  from_address: string | null;
  reply_to_address: string | null;
  email_address: string | null;
  subject: string | null;
  received_at: string;
};

/**
 * Who to write to: the most recent sender who is not a no-reply, reply-to
 * first, since an applicant tracker sends from a no-reply and points replies
 * at the recruiter. The thread lines name each sender as the mail did.
 */
export function addressFromThread(messages: readonly MessageRow[]): {
  toAddress: string | null;
  fromInbox: string | null;
  recipientName: string | null;
  thread: ThreadLine[];
} {
  let toHeader: string | null = null;
  for (const message of messages) {
    const header = message.reply_to_address ?? message.from_address;
    const address = addressOnly(header);
    if (address && !isNoReply(address)) {
      toHeader = header;
      break;
    }
  }
  return {
    toAddress: addressOnly(toHeader),
    recipientName: displayName(toHeader),
    fromInbox: messages[0]?.email_address ?? null,
    thread: messages.map((message) => ({
      at: message.received_at,
      from: displayName(message.from_address) ?? addressOnly(message.from_address),
      subject: message.subject,
    })),
  };
}
