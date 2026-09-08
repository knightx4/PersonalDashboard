import Link from 'next/link';
import { CalendarClock } from 'lucide-react';
import { createClient, requireUser } from '@/lib/jobs/auth/server';
import { PageHeader } from '@/components/shell/page-header';
import { Banner } from '@/components/ui/banner';
import { EmptyState } from '@/components/ui/empty-state';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { formatInterviewWhen } from '@/lib/jobs/applications/load';
import { DEBRIEF_NUDGE_WINDOW_DAYS } from '@/lib/jobs/pipeline';

export const metadata = { title: 'Interviews' };

/**
 * The interview itself, not just the pursuit it belongs to.
 *
 * An interview has no page of its own -- it lives on the role's interviews
 * tab, which scrolls to it and highlights it when named in the query. That
 * link already existed and was used from This week and from the agenda; this
 * page, the one actually called Interviews, sent every click to the top of the
 * role instead, so finding the round you had clicked on meant hunting for it.
 */
function interviewHref(roleId: string, interviewId: string): string {
  return `/jobs/roles/${roleId}?tab=interviews&interview=${interviewId}`;
}

/**
 * What round this is, read off the round rather than the interview.
 *
 * The number belongs to the round now, and a round can have been given a name
 * instead of, or as well as, a number -- "Final round" says more than "3". A
 * round with neither is one nobody has placed yet, which the column says
 * plainly rather than inventing a number for.
 */
function roundName(group: { round_number: number | null; label: string | null } | null): string {
  if (!group) return '—';
  if (group.label && group.round_number !== null) return `${group.round_number} · ${group.label}`;
  if (group.label) return group.label;
  if (group.round_number !== null) return String(group.round_number);
  return '—';
}

export default async function InterviewsPage() {
  const user = await requireUser();
  const supabase = await createClient();

  const [{ data: interviews }, { data: profile }] = await Promise.all([
    supabase
      .from('interviews')
      .select(
        'id, kind, scheduled_at, time_known, format, status, notes, interview_groups ( round_number, label ), applications!inner ( id, roles!inner ( id, title, companies!inner ( name ) ) )',
      )
      .eq('user_id', user.id)
      .order('scheduled_at', { ascending: false }),
    supabase.from('profiles').select('timezone').eq('id', user.id).single(),
  ]);

  const timezone = (profile?.timezone as string) ?? 'UTC';

  type Row = {
    id: string;
    /** The round it is in, which is what carries the number and the name. */
    interview_groups: { round_number: number | null; label: string | null } | null;
    kind: string;
    scheduled_at: string | null;
    /** False when only the day is settled — see formatInterviewWhen. */
    time_known: boolean | null;
    format: string | null;
    status: string;
    notes: string | null;
    applications: { id: string; roles: { id: string; title: string; companies: { name: string } } };
  };

  const rows = (interviews ?? []) as unknown as Row[];

  if (rows.length === 0) {
    return (
      <>
        <PageHeader title="Interviews" description="Scheduled and past, with the debrief." />
        <EmptyState
          icon={CalendarClock}
          title="No interviews yet"
          description="They appear here when a scheduling email arrives — and the app will ask you for the debrief the same evening, because one written three days later is worth very little."
          action={{ label: 'Back to the pipeline', href: '/jobs/pipeline' }}
        />
      </>
    );
  }

  const { upcoming, past, needDebrief } = splitByTime(rows);

  return (
    <>
      <PageHeader
        title="Interviews"
        description={
          needDebrief.length > 0
            ? `${needDebrief.length} still need a debrief.`
            : 'Every past interview has been written up.'
        }
      />

      {needDebrief.length > 0 && (
        <Banner tone="warn" className="mb-6" icon={false}>
          <h2 className="text-ui font-semibold text-ink">Write these up tonight</h2>
          <ul className="mt-2 space-y-1">
            {needDebrief.map((row) => (
              <li key={row.id} className="text-ui">
                {/* Straight to the round that needs writing up, which is the
                    only reason this list exists. */}
                <Link
                  href={interviewHref(row.applications.roles.id, row.id)}
                  className="font-medium text-ink transition-colors duration-150 hover:text-accent"
                >
                  {row.applications.roles.companies.name} · {row.applications.roles.title}
                </Link>
                <span className="tabular ml-2 text-ink-muted">
                  {formatInterviewWhen(row.scheduled_at, row.time_known ?? true, timezone)}
                </span>
              </li>
            ))}
          </ul>
        </Banner>
      )}

      <Section title="Upcoming" rows={upcoming} timezone={timezone} />
      <Section title="Past" rows={past} timezone={timezone} />
    </>
  );
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Split into upcoming and past. Outside the component because reading the clock
 * during render gives a different answer on every re-render.
 *
 * needDebrief is further bounded to the last DEBRIEF_NUDGE_WINDOW_DAYS: an
 * interview from months ago with no notes is stale, not "write it up
 * tonight" — it stays visible in the Past table without the urgent banner.
 */
function splitByTime<
  T extends { scheduled_at: string | null; time_known: boolean | null; notes: string | null },
>(rows: T[]): { upcoming: T[]; past: T[]; needDebrief: T[] } {
  const now = Date.now();
  const debriefWindowStart = now - DEBRIEF_NUDGE_WINDOW_DAYS * DAY_MS;

  // A round known only by its day is stored at that day's midnight. It has not
  // happened until the day is over, so the day itself counts as upcoming --
  // otherwise an interview this afternoon reads as past all morning.
  const over = (row: T): number | null =>
    row.scheduled_at === null
      ? null
      : new Date(row.scheduled_at).getTime() + (row.time_known === false ? DAY_MS : 0);

  const upcoming = rows.filter((row) => {
    const at = over(row);
    return at !== null && at >= now;
  });
  const past = rows.filter((row) => {
    const at = over(row);
    return at === null || at < now;
  });
  const needDebrief = past.filter((row) => {
    const at = over(row);
    return !row.notes && at !== null && at >= debriefWindowStart;
  });
  return { upcoming, past, needDebrief };
}

function Section({
  title,
  rows,
  timezone,
}: {
  title: string;
  rows: Array<{
    id: string;
    /** The round it is in, which is what carries the number and the name. */
    interview_groups: { round_number: number | null; label: string | null } | null;
    kind: string;
    scheduled_at: string | null;
    time_known: boolean | null;
    format: string | null;
    status: string;
    notes: string | null;
    applications: { id: string; roles: { id: string; title: string; companies: { name: string } } };
  }>;
  timezone: string;
}) {
  if (rows.length === 0) return null;

  return (
    <section className="mb-6">
      <h2 className="mb-2 text-ui font-semibold text-ink">{title}</h2>
      <Table>
        <THead>
          <TR>
            <TH>When</TH>
            <TH>Company</TH>
            <TH>Role</TH>
            <TH>Round</TH>
            <TH>Kind</TH>
            <TH>Debrief</TH>
          </TR>
        </THead>
        <TBody>
          {rows.map((row) => (
            /* The interview, and the role, as two separate destinations.
               Both are things you might want from this table and only one
               of them was reachable. The row goes to the interview; the role
               cell keeps its own link, lifted above the row link with `relative`. */
            <TR key={row.id} href={interviewHref(row.applications.roles.id, row.id)}>
              <TD primary className="tabular">
                {formatInterviewWhen(row.scheduled_at, row.time_known ?? true, timezone)}
              </TD>
              <TD label="Company" muted>
                {row.applications.roles.companies.name}
              </TD>
              <TD label="Role" muted>
                <Link
                  href={`/jobs/roles/${row.applications.roles.id}`}
                  className="relative transition-colors duration-150 hover:text-accent"
                >
                  {row.applications.roles.title}
                </Link>
              </TD>
              <TD label="Round" muted>
                {roundName(row.interview_groups)}
              </TD>
              <TD label="Kind" muted>
                {row.kind.replace(/_/g, ' ')}
              </TD>
              <TD label="Debrief" muted>
                {row.notes ? 'written' : '—'}
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </section>
  );
}
