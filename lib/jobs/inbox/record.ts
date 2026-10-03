import { recordScheduled, scheduledBefore } from '@/lib/core/scheduled-actions';
import { formatInstant } from '@/lib/goals/dates';
import type { MessageClassification } from '@/lib/jobs/email/classify';
import type { ApplicationStatus } from '@/lib/jobs/pipeline';
import { statusLabel } from '@/lib/jobs/status-label';

/**
 * Recording what the mail sync files in the job search (plan #1575, feature
 * #1456).
 *
 * The job linker in ./ingest-messages.ts adds and changes companies, roles,
 * applications, events, interviews and contacts, and one email can touch
 * several. Each change becomes one scheduled record Home lists with an Undo:
 *
 *   a new company   one record for the company, with the role, application,
 *                   events and interviews the same email made under it
 *   a new role      the same, for the role, when the company was known
 *   an event        filed on a pursuit that was already there. The status is
 *                   derived from the events by a trigger, so deleting the
 *                   event puts the status back as well
 *   an interview    a new round with its interview and panel, or an invite
 *                   that moved or cancelled one already booked
 *   a contact       added, or given the address it was missing
 *   a participant   a known contact put on an interview already booked
 *   a company       taught a domain or a job board
 *   a role          renamed from the placeholder title
 *
 * Every record waits until the email's writes are done (JobRecorder.flush).
 * An undo of an add is refused when rows were added under it after it was
 * recorded (DEPENDENTS in lib/core/dash-actions.ts), and waiting is what keeps
 * the email's own rows out of that count.
 */

export type JobTable =
  | 'companies'
  | 'roles'
  | 'application_events'
  | 'interview_groups'
  | 'interviews'
  | 'contacts'
  | 'interview_participants';

export function jobRef(table: JobTable, id: string): string {
  return `job_search.${table}:${id}`;
}

/** Reads for the sentences: plain selects, so any client will do. */
type Reader = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => { maybeSingle: () => PromiseLike<{ data: unknown }> };
    };
  };
};

async function one(client: unknown, table: string, columns: string, id: string): Promise<Record<string, unknown> | null> {
  try {
    const { data } = await (client as Reader).from(table).select(columns).eq('id', id).maybeSingle();
    return (data as Record<string, unknown> | null) ?? null;
  } catch {
    return null;
  }
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/** The company's name, or null. */
export async function companyName(client: unknown, companyId: string | null): Promise<string | null> {
  return companyId ? text((await one(client, 'companies', 'name', companyId))?.name) : null;
}

/** "Designer at Acme", from a role. */
export async function roleName(client: unknown, roleId: string): Promise<string> {
  const role = await one(client, 'roles', 'title, company_id', roleId);
  const title = text(role?.title) ?? 'a role';
  const company = await companyName(client, (role?.company_id as string | null) ?? null);
  return company ? `${title} at ${company}` : title;
}

/** "Designer at Acme", from an application. */
export async function pursuitName(client: unknown, applicationId: string): Promise<string> {
  const application = await one(client, 'applications', 'role_id', applicationId);
  const roleId = application?.role_id as string | undefined;
  return roleId ? roleName(client, roleId) : 'an application';
}

async function statusOf(client: unknown, applicationId: string): Promise<ApplicationStatus | null> {
  return ((await one(client, 'applications', 'status', applicationId))?.status as ApplicationStatus | undefined) ?? null;
}

/** What the email was, as "a rejection email". */
export function mailPhrase(classification: MessageClassification): string {
  switch (classification) {
    case 'application_confirmation':
      return 'a confirmation email';
    case 'rejection':
      return 'a rejection email';
    case 'interview_invite':
      return 'an interview invitation';
    case 'scheduling':
      return 'a scheduling email';
    case 'assessment':
      return 'an assessment invitation';
    case 'offer':
      return 'an offer email';
    case 'recruiter_reply':
      return 'a reply from a recruiter';
    case 'recruiter_outreach':
      return 'a recruiter’s email';
    default:
      return 'an email';
  }
}

/** "a recruiter screen", "a technical interview". */
export function interviewPhrase(kind: string | null): string {
  const label = (kind ?? 'interview').replace(/_/g, ' ');
  const noun = /(screen|interview|onsite)$/.test(label) ? label : `${label} interview`;
  return `${/^[aeiou]/.test(noun) ? 'an' : 'a'} ${noun}`;
}

function when(iso: string | null | undefined, timeZone: string | null): string | null {
  if (!iso) return null;
  try {
    return formatInstant(iso, timeZone ?? 'UTC');
  } catch {
    return null;
  }
}

function vendorName(vendor: string): string {
  return vendor.charAt(0).toUpperCase() + vendor.slice(1);
}

/**
 * The records one email's writes leave, kept until the writes are done.
 * Recording never throws and never stops the sync (recordScheduled).
 */
export class JobRecorder {
  private readonly pending: (() => Promise<unknown>)[] = [];

  constructor(
    readonly client: unknown,
    readonly userId: string,
    readonly mail: MessageClassification,
    readonly timeZone: string | null,
  ) {}

  /** The row as it is now, for an update's before values. */
  before(table: JobTable, id: string): Promise<Record<string, unknown> | null> {
    return scheduledBefore(this.client, this.userId, jobRef(table, id));
  }

  private later(record: () => Promise<unknown>): void {
    this.pending.push(record);
  }

  /** Write every record this email left, in the order the writes happened. */
  async flush(): Promise<void> {
    const pending = this.pending.splice(0);
    for (const record of pending) {
      try {
        await record();
      } catch (error) {
        console.error('job sync: could not record a change', error);
      }
    }
  }

  private record(kind: string, table: JobTable, id: string, summary: string, before?: Record<string, unknown> | null) {
    return recordScheduled(this.client, this.userId, {
      kind,
      subjectRef: jobRef(table, id),
      op: before === undefined ? 'insert' : 'update',
      summary,
      ...(before === undefined ? {} : { beforeValues: before }),
    });
  }

  /** How the new pursuit reads once the email's events are on it. */
  private async pursuitPhrase(applicationId: string | null, asLead: boolean): Promise<string> {
    if (!applicationId) return '';
    const status = await statusOf(this.client, applicationId);
    if (!status) return asLead ? ' as a lead' : '';
    return status === 'lead' ? ' as a lead' : `, where it reads ${statusLabel(status)}`;
  }

  /** A company the email named that the job search did not have, with what came with it. */
  companyAdded(opts: { companyId: string; roleId: string | null; applicationId: string | null; asLead: boolean }) {
    this.later(async () => {
      const company = (await companyName(this.client, opts.companyId)) ?? 'a company';
      const role = opts.roleId ? text((await one(this.client, 'roles', 'title', opts.roleId))?.title) : null;
      const what = role ? `${company} and the role ${role}` : company;
      const where = await this.pursuitPhrase(opts.applicationId, opts.asLead);
      await this.record(
        'add_company',
        'companies',
        opts.companyId,
        `Dash added ${what} to your job search${where}, from ${mailPhrase(this.mail)}.`,
      );
    });
  }

  /** A role, with its application, at a company the job search already had. */
  roleAdded(opts: { roleId: string; applicationId: string | null; asLead: boolean }) {
    this.later(async () => {
      const name = await roleName(this.client, opts.roleId);
      const where = await this.pursuitPhrase(opts.applicationId, opts.asLead);
      await this.record(
        'add_role',
        'roles',
        opts.roleId,
        `Dash added ${name} to your job search${where}, from ${mailPhrase(this.mail)}.`,
      );
    });
  }

  /** The placeholder title replaced by the one a later email gave. */
  roleRenamed(opts: { roleId: string; before: Record<string, unknown> | null }) {
    this.later(async () => {
      const name = await roleName(this.client, opts.roleId);
      const old = text(opts.before?.title);
      const from = old ? `, which was called “${old}”` : '';
      await this.record(
        'name_role',
        'roles',
        opts.roleId,
        `Dash named the role ${name}${from}, from ${mailPhrase(this.mail)}.`,
        opts.before,
      );
    });
  }

  /** An event filed on a pursuit that was already there, and what it did to the status. */
  eventFiled(opts: { eventId: string; applicationId: string; statusBefore: ApplicationStatus }) {
    this.later(async () => {
      const name = await pursuitName(this.client, opts.applicationId);
      const now = await statusOf(this.client, opts.applicationId);
      const moved =
        now && statusLabel(now) !== statusLabel(opts.statusBefore)
          ? `, which moved it from ${statusLabel(opts.statusBefore)} to ${statusLabel(now)}`
          : '';
      await this.record(
        'file_job_email',
        'application_events',
        opts.eventId,
        `Dash filed ${mailPhrase(this.mail)} on ${name}${moved}.`,
      );
    });
  }

  /** A new round, with the interview the email booked in it and its panel. */
  interviewBooked(opts: { groupId: string; interviewId: string; applicationId: string }) {
    this.later(async () => {
      const interview = await one(this.client, 'interviews', 'kind, scheduled_at', opts.interviewId);
      const name = await pursuitName(this.client, opts.applicationId);
      const at = when(interview?.scheduled_at as string | undefined, this.timeZone);
      await this.record(
        'book_interview',
        'interview_groups',
        opts.groupId,
        `Dash added ${interviewPhrase((interview?.kind as string | undefined) ?? null)} for ${name}${at ? ` on ${at}` : ''}, from ${mailPhrase(this.mail)}.`,
      );
    });
  }

  /** An interview already booked, moved or cancelled by a newer invite. */
  interviewChanged(opts: { interviewId: string; applicationId: string; before: Record<string, unknown> | null }) {
    this.later(async () => {
      const after = await one(this.client, 'interviews', 'scheduled_at, status', opts.interviewId);
      const name = await pursuitName(this.client, opts.applicationId);
      const was = when(opts.before?.scheduled_at as string | undefined, this.timeZone);
      const now = when(after?.scheduled_at as string | undefined, this.timeZone);
      const summary =
        after?.status === 'cancelled' && opts.before?.status !== 'cancelled'
          ? `Dash marked your interview for ${name}${now ? ` on ${now}` : ''} cancelled, from an updated calendar invite.`
          : was && now && was !== now
            ? `Dash moved your interview for ${name} from ${was} to ${now}, from an updated calendar invite.`
            : `Dash updated your interview for ${name}${now ? ` on ${now}` : ''} from an updated calendar invite.`;
      await this.record('update_interview', 'interviews', opts.interviewId, summary, opts.before);
    });
  }

  /** A person the email named, added to the contacts. */
  contactAdded(opts: { contactId: string; companyId: string | null; interviewFor: string | null }) {
    this.later(async () => {
      const contact = await one(this.client, 'contacts', 'full_name', opts.contactId);
      const who = text(contact?.full_name) ?? 'someone';
      const company = await companyName(this.client, opts.companyId);
      const at = company ? ` at ${company}` : '';
      const why = opts.interviewFor
        ? `as an interviewer for ${await pursuitName(this.client, opts.interviewFor)}`
        : 'from an email they sent';
      await this.record('add_contact', 'contacts', opts.contactId, `Dash added ${who}${at} to your contacts, ${why}.`);
    });
  }

  /** A contact given the address they wrote from, where it had none. */
  contactEmailAdded(opts: { contactId: string; email: string; before: Record<string, unknown> | null }) {
    this.later(async () => {
      const who = text(opts.before?.full_name) ?? 'a contact';
      await this.record(
        'fill_contact_email',
        'contacts',
        opts.contactId,
        `Dash added ${opts.email} to ${who}’s contact details, from an email they sent.`,
        opts.before,
      );
    });
  }

  /** A known contact put on an interview that was already booked. */
  participantAdded(opts: { participantId: string; contactId: string; interviewId: string }) {
    this.later(async () => {
      const contact = await one(this.client, 'contacts', 'full_name', opts.contactId);
      const interview = await one(this.client, 'interviews', 'application_id, scheduled_at', opts.interviewId);
      const applicationId = interview?.application_id as string | undefined;
      const name = applicationId ? await pursuitName(this.client, applicationId) : 'an interview';
      const at = when(interview?.scheduled_at as string | undefined, this.timeZone);
      await this.record(
        'add_interviewer',
        'interview_participants',
        opts.participantId,
        `Dash put ${text(contact?.full_name) ?? 'a contact'} on your interview for ${name}${at ? ` on ${at}` : ''}, from ${mailPhrase(this.mail)}.`,
      );
    });
  }

  /** A company taught a domain its mail comes from. */
  companyDomainLearned(opts: { companyId: string; domain: string; before: Record<string, unknown> | null }) {
    this.later(async () => {
      const company = (await companyName(this.client, opts.companyId)) ?? 'a company';
      await this.record(
        'learn_company_domain',
        'companies',
        opts.companyId,
        `Dash noted that mail from ${opts.domain} is from ${company}, so later mail from there files under it.`,
        opts.before,
      );
    });
  }

  /** A company taught which job board it probably posts on. */
  companyBoardLearned(opts: {
    companyId: string;
    hint: string | null;
    vendor: string | null;
    before: Record<string, unknown> | null;
  }) {
    this.later(async () => {
      const company = (await companyName(this.client, opts.companyId)) ?? 'a company';
      const vendor = opts.vendor ? vendorName(opts.vendor) : null;
      const board =
        vendor && opts.hint
          ? `the ${vendor} board “${opts.hint}”`
          : vendor
            ? vendor
            : `a job board called “${opts.hint ?? ''}”`;
      await this.record(
        'learn_job_board',
        'companies',
        opts.companyId,
        `Dash noted that ${company} probably posts its jobs on ${board}, so their descriptions can be looked up.`,
        opts.before,
      );
    });
  }
}
