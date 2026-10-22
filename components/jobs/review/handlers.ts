import {
  acknowledgeEvent,
  confirmApplication,
  createRoleFromMessage,
  deleteInferredApplication,
  excludeCompanyForApplication,
  linkMessage,
  reopenApplication,
} from '@/app/jobs/(app)/review/actions';

/**
 * What pressing a button on a review row comes to, for whichever page drew the
 * row: the Review page shows `message` as its one status line, and the Jobs
 * Inbox shows a failure on the row itself (plan #2502). Both say the same
 * words because both come from here.
 */
export type ReviewOutcome = { ok: boolean; message: string };

function outcome(result: { error: string | null }, done: string): ReviewOutcome {
  return result.error ? { ok: false, message: result.error } : { ok: true, message: done };
}

/** File a held message against a pursuit. */
export async function linkToRole(
  messageId: string,
  applicationId: string,
  label: string,
): Promise<ReviewOutcome> {
  return outcome(await linkMessage(messageId, applicationId), `Linked to ${label}.`);
}

/** Start a new role from a held message and link the message to it. */
export async function startRoleFromMessage(input: {
  messageId: string;
  companyName: string;
  title: string;
}): Promise<ReviewOutcome> {
  return outcome(
    await createRoleFromMessage(input),
    `Started ${input.companyName} · ${input.title} and linked this message to it.`,
  );
}

/** "Looks right" on an application the inbox created from mail. */
export async function confirmImported(applicationId: string): Promise<ReviewOutcome> {
  return outcome(await confirmApplication(applicationId), 'Confirmed.');
}

/** "Not relevant" on an application the inbox created from mail. */
export async function removeImported(applicationId: string): Promise<ReviewOutcome> {
  return outcome(await deleteInferredApplication(applicationId), 'Removed.');
}

/** Remove an imported application and stop its employer's mail opening another. */
export async function excludeImportedCompany(applicationId: string): Promise<ReviewOutcome> {
  const result = await excludeCompanyForApplication(applicationId);
  return outcome(result, result.message ?? 'Excluded.');
}

/** Leave a pursuit closed when an event arrived after it closed. */
export async function acknowledgeLateEvent(eventId: string): Promise<ReviewOutcome> {
  return outcome(await acknowledgeEvent(eventId), 'Left closed.');
}

/** They really did come back: reopen the pursuit as in process. */
export async function reopenFromEvent(applicationId: string): Promise<ReviewOutcome> {
  return outcome(await reopenApplication(applicationId, 'in_process'), 'Reopened as in process.');
}
