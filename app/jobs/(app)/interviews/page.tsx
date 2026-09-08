import Link from 'next/link';
import { CalendarClock } from 'lucide-react';
import { createClient, requireUser } from '@/lib/jobs/auth/server';
import { PageHeader } from '@/components/shell/page-header';
import { Banner } from '@/components/ui/banner';
import { EmptyState } from '@/components/ui/empty-state';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { formatInterviewWhen } from '@/lib/jobs/applications/load';
import { interviewKindLabel } from '@/lib/jobs/interview-kinds';
import { roundLabel, roundsOf } from '@/lib/jobs/interview-groups';
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

export default async function InterviewsPage() {
  const user = await requireUser();
  const supabase = await createClient();

  const [{ data: interviews }, { data: profile }] = await Promise.all([
    supabase
      .from('interviews')
      .select(
        'id, kind, scheduled_at, time_known, format, status, notes, group_id, interview_groups ( id, round_number, label, notes ), applications!inner ( id, roles!inner ( id, title, companies!inner ( name ) ) )',
      )
      .eq('user_id', user.id)
      .order('scheduled_at', { ascending: false }),
    supabase.from('profiles').select('timezone').eq('id', user.id).single(),
  ]);

  const timezone = (profile?.timezone as string) ?? 'UTC';

  type Row = {
    id: string;
    group_id: string | null;
    /** The round it is in, which is what carries the number and the name. */
    interview_groups: {
      id: string;
      round_number: number | null;
      label: string | null;
      notes: string | null;
    } | null;
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

  /**
   * One row per round, not per interview.
   *
   * A superday is one occasion with four conversations in it. Listed four
   * times over it reads as four separate things to prepare for and four
   * separate debriefs to write, when it is one of each. The role's own
   * Interviews tab is where the individual conversation is read.
   */
  const rounds: RoundView[] = roundsOf(
    rows.map((row) => ({ id: row.id, scheduledAt: row.scheduled_at, groupId: row.group_id, row })),
    rows
      .map((row) => row.interview_groups)
      .filter((group): group is NonNullable<Row['interview_groups']> => group !== null)
      .map((group) => ({
        id: group.id,
        label: group.label,
        roundNumber: group.round_number,
        notes: group.notes ?? '',
      })),
  ).map(({ group, interviews: members, lead }) => {
    const times = members
      .map((member) => whenOf(member.row))
      .filter((time): time is { at: number; display: string; timeKnown: boolean } => time !== null);
    // Shown at its first conversation, and over only once its last one is.
    const first = times.length > 0 ? times.reduce((a, b) => (a.at <= b.at ? a : b)) : null;
    const last = times.length > 0 ? times.reduce((a, b) => (a.at >= b.at ? a : b)) : null;

    return {
      key: group?.id ?? lead.id,
      leadId: lead.row.id,
      roleId: lead.row.applications.roles.id,
      companyName: lead.row.applications.roles.companies.name,
      roleTitle: lead.row.applications.roles.title,
      scheduledAt: first?.display ?? null,
      timeKnown: first?.timeKnown ?? true,
      endsAt: last === null ? null : last.at + (last.timeKnown ? 0 : DAY_MS),
      round: roundLabel(group),
      // Four conversations in a day is what the row has to say; one is worth
      // naming by what it was.
      kind:
        members.length > 1
          ? `${members.length} interviews`
          : interviewKindLabel(lead.row.kind),
      // Written up anywhere in the round: the round's own note, or any of its
      // conversations. One debrief for one occasion.
      notes:
        (group?.notes?.trim() ? group.notes : null) ??
        members.find((member) => member.row.notes?.trim())?.row.notes ??
        null,
    };
  });

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

  const { upcoming, past, needDebrief } = splitByTime(rounds);

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
              <li key={row.key} className="text-ui">
                {/* Straight to the round that needs writing up, which is the
                    only reason this list exists. */}
                <Link
                  href={interviewHref(row.roleId, row.leadId)}
                  className="font-medium text-ink transition-colors duration-150 hover:text-accent"
                >
                  {row.companyName} · {row.roleTitle}
                </Link>
                <span className="tabular ml-2 text-ink-muted">
                  {formatInterviewWhen(row.scheduledAt, row.timeKnown, timezone)}
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

/** A round as this page draws it: one line, whatever is inside it. */
type RoundView = {
  key: string;
  /** The conversation a link lands on: the first of the round. */
  leadId: string;
  roleId: string;
  companyName: string;
  roleTitle: string;
  /** When the round starts. Null where nothing in it is scheduled yet. */
  scheduledAt: string | null;
  timeKnown: boolean;
  /** When the last of it is over, as an instant. Null when unscheduled. */
  endsAt: number | null;
  round: string | null;
  kind: string;
  /** Anything written up about the round, from the round or from inside it. */
  notes: string | null;
};

/**
 * When one interview is, and until when.
 *
 * A round known only by its day is stored at that day's midnight, so the day
 * itself counts as upcoming -- otherwise an interview this afternoon reads as
 * past all morning.
 */
function whenOf(row: {
  scheduled_at: string | null;
  time_known: boolean | null;
}): { at: number; display: string; timeKnown: boolean } | null {
  if (row.scheduled_at === null) return null;
  return {
    at: new Date(row.scheduled_at).getTime(),
    display: row.scheduled_at,
    timeKnown: row.time_known !== false,
  };
}

/**
 * Split into upcoming and past. Outside the component because reading the clock
 * during render gives a different answer on every re-render.
 *
 * A round is upcoming until its last conversation is over, not its first: a
 * two-day final is not history halfway through.
 *
 * needDebrief is further bounded to the last DEBRIEF_NUDGE_WINDOW_DAYS: a round
 * from months ago with no notes is stale, not "write it up tonight" — it stays
 * visible in the Past table without the urgent banner.
 */
function splitByTime<T extends { endsAt: number | null; notes: string | null }>(
  rows: T[],
): { upcoming: T[]; past: T[]; needDebrief: T[] } {
  const now = Date.now();
  const debriefWindowStart = now - DEBRIEF_NUDGE_WINDOW_DAYS * DAY_MS;

  const upcoming = rows.filter((row) => row.endsAt !== null && row.endsAt >= now);
  const past = rows.filter((row) => row.endsAt === null || row.endsAt < now);
  const needDebrief = past.filter(
    (row) => !row.notes && row.endsAt !== null && row.endsAt >= debriefWindowStart,
  );
  return { upcoming, past, needDebrief };
}

function Section({
  title,
  rows,
  timezone,
}: {
  title: string;
  rows: RoundView[];
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
            /* The round, and the role, as two separate destinations.
               Both are things you might want from this table and only one
               of them was reachable. The row goes to the round; the role
               cell keeps its own link, lifted above the row link with `relative`. */
            <TR key={row.key} href={interviewHref(row.roleId, row.leadId)}>
              <TD primary className="tabular">
                {formatInterviewWhen(row.scheduledAt, row.timeKnown, timezone)}
              </TD>
              <TD label="Company" muted>
                {row.companyName}
              </TD>
              <TD label="Role" muted>
                <Link
                  href={`/jobs/roles/${row.roleId}`}
                  className="relative transition-colors duration-150 hover:text-accent"
                >
                  {row.roleTitle}
                </Link>
              </TD>
              <TD label="Round" muted>
                {row.round ?? '—'}
              </TD>
              <TD label="Kind" muted>
                {row.kind}
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
