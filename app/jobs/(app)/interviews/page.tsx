import Link from 'next/link';
import { CalendarClock } from 'lucide-react';
import { createClient, requireUser } from '@/lib/jobs/auth/server';
import { PageHeader } from '@/components/shell/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { formatDateTime } from '@/lib/jobs/applications/load';
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
        'id, round, kind, scheduled_at, format, status, notes, applications!inner ( id, roles!inner ( id, title, companies!inner ( name ) ) )',
      )
      .eq('user_id', user.id)
      .order('scheduled_at', { ascending: false }),
    supabase.from('profiles').select('timezone').eq('id', user.id).single(),
  ]);

  const timezone = (profile?.timezone as string) ?? 'UTC';

  type Row = {
    id: string;
    round: number;
    kind: string;
    scheduled_at: string | null;
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
        <section className="mb-6 rounded-card border border-caution bg-caution-tint p-4">
          <h2 className="text-ui font-semibold text-ink">Write these up tonight</h2>
          <ul className="mt-2 space-y-1">
            {needDebrief.map((row) => (
              <li key={row.id} className="text-ui">
                {/* Straight to the round that needs writing up, which is the
                    only reason this list exists. */}
                <Link
                  href={interviewHref(row.applications.roles.id, row.id)}
                  className="font-medium text-ink hover:text-accent"
                >
                  {row.applications.roles.companies.name} · {row.applications.roles.title}
                </Link>
                <span className="tabular ml-2 text-ink-muted">
                  {formatDateTime(row.scheduled_at, timezone)}
                </span>
              </li>
            ))}
          </ul>
        </section>
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
function splitByTime<T extends { scheduled_at: string | null; notes: string | null }>(
  rows: T[],
): { upcoming: T[]; past: T[]; needDebrief: T[] } {
  const now = Date.now();
  const debriefWindowStart = now - DEBRIEF_NUDGE_WINDOW_DAYS * DAY_MS;
  const upcoming = rows.filter(
    (row) => row.scheduled_at !== null && new Date(row.scheduled_at).getTime() >= now,
  );
  const past = rows.filter(
    (row) => row.scheduled_at === null || new Date(row.scheduled_at).getTime() < now,
  );
  const needDebrief = past.filter(
    (row) =>
      !row.notes &&
      row.scheduled_at !== null &&
      new Date(row.scheduled_at).getTime() >= debriefWindowStart,
  );
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
    round: number;
    kind: string;
    scheduled_at: string | null;
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
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-ui">
          <thead>
            <tr className="border-b border-border text-left text-micro uppercase tracking-wider text-ink-muted">
              <th className="px-2 py-2 font-semibold">When</th>
              <th className="px-2 py-2 font-semibold">Company</th>
              <th className="px-2 py-2 font-semibold">Role</th>
              <th className="px-2 py-2 font-semibold">Round</th>
              <th className="px-2 py-2 font-semibold">Kind</th>
              <th className="px-2 py-2 font-semibold">Debrief</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-border hover:bg-surface">
                {/* The interview, and the role, as two separate destinations.
                    Both are things you might want from this table and only one
                    of them was reachable. */}
                <td className="tabular px-2 py-1.5">
                  <Link
                    href={interviewHref(row.applications.roles.id, row.id)}
                    className="font-medium text-ink hover:text-accent"
                  >
                    {formatDateTime(row.scheduled_at, timezone)}
                  </Link>
                </td>
                <td className="px-2 py-1.5 text-ink-muted">
                  {row.applications.roles.companies.name}
                </td>
                <td className="px-2 py-1.5">
                  <Link
                    href={`/jobs/roles/${row.applications.roles.id}`}
                    className="text-ink-muted hover:text-accent"
                  >
                    {row.applications.roles.title}
                  </Link>
                </td>
                <td className="tabular px-2 py-1.5 text-ink-muted">{row.round}</td>
                <td className="px-2 py-1.5 text-ink-muted">{row.kind.replace(/_/g, ' ')}</td>
                <td className="px-2 py-1.5 text-ink-muted">
                  {row.notes ? 'written' : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
