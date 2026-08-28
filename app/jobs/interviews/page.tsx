import Link from 'next/link';
import { CalendarClock } from 'lucide-react';
import { createClient, requireUser } from '@/lib/jobs/auth/server';
import { PageHeader } from '@/components/jobs/shell/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { formatDateTime } from '@/lib/jobs/applications/load';

export const metadata = { title: 'Interviews' };

export default async function InterviewsPage() {
  const user = await requireUser();
  const supabase = await createClient();

  const [{ data: interviews }, { data: profile }] = await Promise.all([
    supabase
      .from('interviews')
      .select(
        'id, round, kind, scheduled_at, format, status, went_well, went_poorly, applications!inner ( id, roles!inner ( id, title, companies!inner ( name ) ) )',
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
    went_well: string | null;
    went_poorly: string | null;
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
        <section className="mb-6 rounded-card border border-accent-orange bg-accent-orange-tint p-4">
          <h2 className="text-[13px] font-semibold text-ink">Write these up tonight</h2>
          <ul className="mt-2 space-y-1">
            {needDebrief.map((row) => (
              <li key={row.id} className="text-[13px]">
                <Link
                  href={`/jobs/roles/${row.applications.roles.id}`}
                  className="font-medium text-ink hover:text-brand"
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

/**
 * Split into upcoming and past. Outside the component because reading the clock
 * during render gives a different answer on every re-render.
 */
function splitByTime<T extends { scheduled_at: string | null; went_well: string | null; went_poorly: string | null }>(
  rows: T[],
): { upcoming: T[]; past: T[]; needDebrief: T[] } {
  const now = Date.now();
  const upcoming = rows.filter(
    (row) => row.scheduled_at !== null && new Date(row.scheduled_at).getTime() >= now,
  );
  const past = rows.filter(
    (row) => row.scheduled_at === null || new Date(row.scheduled_at).getTime() < now,
  );
  return { upcoming, past, needDebrief: past.filter((row) => !row.went_well && !row.went_poorly) };
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
    went_well: string | null;
    went_poorly: string | null;
    applications: { id: string; roles: { id: string; title: string; companies: { name: string } } };
  }>;
  timezone: string;
}) {
  if (rows.length === 0) return null;

  return (
    <section className="mb-6">
      <h2 className="mb-2 text-[13px] font-semibold text-ink">{title}</h2>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-ink-faint">
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
                <td className="tabular px-2 py-1.5 text-ink-muted">
                  {formatDateTime(row.scheduled_at, timezone)}
                </td>
                <td className="px-2 py-1.5 text-ink-muted">
                  {row.applications.roles.companies.name}
                </td>
                <td className="px-2 py-1.5">
                  <Link
                    href={`/jobs/roles/${row.applications.roles.id}`}
                    className="font-medium text-ink hover:text-brand"
                  >
                    {row.applications.roles.title}
                  </Link>
                </td>
                <td className="tabular px-2 py-1.5 text-ink-muted">{row.round}</td>
                <td className="px-2 py-1.5 text-ink-muted">{row.kind.replace(/_/g, ' ')}</td>
                <td className="px-2 py-1.5 text-ink-faint">
                  {row.went_well || row.went_poorly ? 'written' : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
