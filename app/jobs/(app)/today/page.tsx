import Link from 'next/link';
import { CalendarClock, CheckCircle2, Clock, MailQuestion, PenLine, Video } from 'lucide-react';
import { createClient, requireUser } from '@/lib/jobs/auth/server';
import { PageHeader } from '@/components/jobs/shell/page-header';
import { formatDateTime } from '@/lib/jobs/applications/load';
import { loadToday, INTERVIEW_HORIZON_DAYS } from '@/lib/jobs/today/load';
import { ReminderActions } from './reminder-actions';
import { WaitingActions } from './waiting-actions';

export const metadata = { title: 'This week' };

/**
 * What has to happen, and nothing else.
 *
 * The rest of the workspace answers "what is going on" -- 341 pursuits, most
 * of them dead, sorted by recency. This answers "what do I do", which is a
 * different and much shorter question, and it is the one you have on a Monday
 * morning. Sections disappear when they are empty rather than showing a zero:
 * a quiet week should look quiet.
 */
export default async function TodayPage() {
  const user = await requireUser();
  const supabase = await createClient();

  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name, timezone')
    .eq('id', user.id)
    .maybeSingle();

  const timezone = (profile?.timezone as string) ?? 'UTC';

  const board = await loadToday(supabase, user.id, {
    senderName: (profile?.display_name as string) ?? null,
  });

  return (
    <>
      <PageHeader
        title="This week"
        description={
          board.clear
            ? 'Nothing needs you today.'
            : 'The things with a clock on them, in the order they run out.'
        }
      />

      {board.clear && (
        <div className="rounded-card border border-border bg-surface p-8 text-center">
          <CheckCircle2
            className="mx-auto size-8 text-status-offer"
            strokeWidth={1.5}
            aria-hidden
          />
          <p className="mt-3 text-sm font-medium text-ink">Nothing needs you today.</p>
          <p className="mt-1 text-[13px] text-ink-muted">
            No interviews in the next {INTERVIEW_HORIZON_DAYS} days, and nothing waiting on a
            reply.
          </p>
          <Link
            href="/jobs/pipeline"
            className="mt-4 inline-block text-[13px] font-medium text-brand underline underline-offset-2"
          >
            Look at the pipeline anyway
          </Link>
        </div>
      )}

      <div className="space-y-6">
        {board.interviews.length > 0 && (
          <Section
            icon={CalendarClock}
            title="Interviews"
            hint={`In the next ${INTERVIEW_HORIZON_DAYS} days.`}
            tone="brand"
          >
            <ul className="divide-y divide-border">
              {board.interviews.map((interview) => (
                <li
                  key={interview.id}
                  className="relative flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2.5"
                >
                  <span className="tabular w-full text-[13px] font-medium text-ink sm:w-44">
                    {formatDateTime(interview.scheduledAt, timezone)}
                  </span>
                  <Link
                    href={`/jobs/roles/${interview.roleId}?tab=interviews&interview=${interview.id}`}
                    className="text-[13px] font-medium text-ink hover:text-brand"
                  >
                    {/* The whole row opens the same place -- prep materials on
                        the role's Interviews tab -- so this stretches to cover
                        it rather than being the one sliver of the row that
                        responds to a click. */}
                    <span className="absolute inset-0" aria-hidden />
                    {interview.companyName} · {interview.roleTitle}
                  </Link>
                  <span className="text-[12px] text-ink-muted">
                    {interview.kind.replace(/_/g, ' ')}
                    {interview.durationMinutes ? ` · ${interview.durationMinutes} min` : ''}
                  </span>
                  {interview.meetingUrl && (
                    <a
                      href={interview.meetingUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="relative inline-flex items-center gap-1 text-[12px] font-medium text-brand underline underline-offset-2"
                    >
                      <Video className="size-3.5" strokeWidth={1.75} aria-hidden />
                      Join
                    </a>
                  )}
                  {!interview.hasPrep && (
                    <span className="rounded-full bg-accent-orange-tint px-1.5 py-0.5 text-[11px] text-ink">
                      no prep notes
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </Section>
        )}

        {board.waiting.length > 0 && (
          <Section
            icon={MailQuestion}
            title="Waiting on you"
            hint="Mail that asked for something and has not been answered."
          >
            <ul className="divide-y divide-border">
              {board.waiting.map((row) => (
                <li key={row.eventId} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2.5">
                  <span className="tabular w-full text-[12px] text-ink-muted sm:w-44">
                    {formatDateTime(row.occurredAt, timezone)}
                  </span>
                  <Link
                    href={`/jobs/roles/${row.roleId}`}
                    className="text-[13px] font-medium text-ink hover:text-brand"
                  >
                    {row.companyName} · {row.roleTitle}
                  </Link>
                  {row.summary && (
                    <span className="w-full text-[12px] text-ink-muted sm:w-auto sm:flex-1">
                      {row.summary}
                    </span>
                  )}
                  <WaitingActions eventId={row.eventId} />
                </li>
              ))}
            </ul>
          </Section>
        )}

        {board.reminders.length > 0 && (
          <Section icon={Clock} title="Nudges" hint="Raised by the nightly sweep.">
            <ul className="divide-y divide-border">
              {board.reminders.map((reminder) => (
                <li key={reminder.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2.5">
                  {reminder.roleId ? (
                    <Link
                      href={`/jobs/roles/${reminder.roleId}`}
                      className="text-[13px] font-medium text-ink hover:text-brand"
                    >
                      {reminder.companyName} · {reminder.roleTitle}
                    </Link>
                  ) : (
                    <span className="text-[13px] font-medium text-ink">Reminder</span>
                  )}
                  <span className="w-full text-[12px] text-ink-muted sm:w-auto sm:flex-1">
                    {reminder.body}
                  </span>
                  {reminder.followUpHref && <DraftLink href={reminder.followUpHref} />}
                  <ReminderActions id={reminder.id} />
                </li>
              ))}
            </ul>
          </Section>
        )}

      </div>
    </>
  );
}

/**
 * Opens Gmail's own composer with the follow-up already written.
 *
 * Not a draft written through the API: that needs `gmail.compose` on top of
 * the read-only grant this app asks for, and a reconnect to get it. A wider
 * key to the mailbox is a poor trade for saving one click.
 */
function DraftLink({ href }: { href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="press inline-flex shrink-0 items-center gap-1 rounded-lg border border-border bg-canvas px-2 py-0.5 text-[12px] font-medium text-ink"
    >
      <PenLine className="size-3" strokeWidth={2} aria-hidden />
      Draft follow-up
    </a>
  );
}

function Section({
  icon: Icon,
  title,
  hint,
  tone,
  children,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  title: string;
  hint: string;
  tone?: 'brand';
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-card border border-border bg-surface p-4">
      <header className="mb-1 flex items-baseline gap-2">
        <Icon
          className={tone === 'brand' ? 'size-4 text-brand' : 'size-4 text-ink-faint'}
          strokeWidth={1.75}
        />
        <h2 className="text-[13px] font-semibold text-ink">{title}</h2>
        <span className="text-[12px] text-ink-faint">{hint}</span>
      </header>
      {children}
    </section>
  );
}
