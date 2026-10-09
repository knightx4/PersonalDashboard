import { BarChart3 } from 'lucide-react';
import { createClient, requireUser } from '@/lib/jobs/auth/server';
import { PageHeader } from '@/components/shell/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { loadPipeline, toFunnelApplications } from '@/lib/jobs/applications/load';
import { AnalyticsView } from './view';

export const metadata = { title: 'Analytics' };

const DESCRIPTION = 'How far applications from each channel got, and where they stopped.';

export default async function AnalyticsPage() {
  const user = await requireUser();
  const supabase = await createClient();

  const rows = await loadPipeline(supabase, user.id);
  const applications = toFunnelApplications(rows);
  const sent = applications.filter((a) => a.submittedAt !== null);

  if (sent.length === 0) {
    return (
      <>
        <PageHeader title="Analytics" description={DESCRIPTION} />
        <EmptyState
          icon={BarChart3}
          title="Nothing to measure yet"
          description="These numbers need applications with a submission date. They start being useful at about fifteen, and trustworthy at about forty."
          action={{ label: 'Add a role', href: '/jobs/roles/new' }}
        />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Analytics" description={DESCRIPTION} />
      <AnalyticsView applications={applications} />
    </>
  );
}
