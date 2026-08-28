import Link from 'next/link';
import { Building2 } from 'lucide-react';
import { createClient, requireUser } from '@/lib/jobs/auth/server';
import { PageHeader } from '@/components/jobs/shell/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { buttonVariants } from '@/components/ui/button';
import { LeftRail, RailGroup, RailItem } from '@/components/jobs/shell/left-rail';

export const metadata = { title: 'Companies' };

const PRIORITIES = ['target', 'interested', 'backup', 'passed'] as const;

export default async function CompaniesPage({
  searchParams,
}: {
  searchParams: Promise<{ priority?: string }>;
}) {
  const user = await requireUser();
  const supabase = await createClient();
  const params = await searchParams;

  const { data } = await supabase
    .from('companies')
    .select('id, name, slug, priority, status, industry, hq_location, domains, roles ( id )')
    .eq('user_id', user.id)
    .order('name');

  const companies = (data ?? []) as unknown as Array<{
    id: string;
    name: string;
    slug: string;
    priority: string;
    status: string;
    industry: string | null;
    hq_location: string | null;
    domains: string[];
    roles: Array<{ id: string }>;
  }>;

  const priority = PRIORITIES.find((p) => p === params.priority);
  const filtered = priority ? companies.filter((c) => c.priority === priority) : companies;

  if (companies.length === 0) {
    return (
      <>
        <PageHeader
          title="Companies"
          description="The organisations you are pursuing. Separate from roles, because this page stays useful after a posting closes."
        />
        <EmptyState
          icon={Building2}
          title="No companies yet"
          description="A company appears here the moment you add a role at it. You can also add a few up front so inbound mail has something to match against on the first inbox scan."
          action={{ label: 'Add a role', href: '/jobs/roles/new' }}
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Companies"
        description={`${companies.length} tracked. Notes and contacts here outlive any single posting.`}
        actions={
          <Link href="/jobs/roles/new" className={buttonVariants({ size: 'sm' })}>
            Add a role
          </Link>
        }
      />

      <div className="flex gap-6">
        <LeftRail>
          <RailGroup label="Priority">
            <RailItem label="All" href="/jobs/companies" active={!priority} count={companies.length} />
            {PRIORITIES.map((entry) => (
              <RailItem
                key={entry}
                label={entry}
                href={`/jobs/companies?priority=${entry}`}
                active={priority === entry}
                count={companies.filter((c) => c.priority === entry).length}
              />
            ))}
          </RailGroup>
        </LeftRail>

        <div className="min-w-0 flex-1 overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-ink-faint">
                <th className="px-2 py-2 font-semibold">Company</th>
                <th className="px-2 py-2 font-semibold">Priority</th>
                <th className="px-2 py-2 font-semibold">Activity</th>
                <th className="px-2 py-2 font-semibold">Roles</th>
                <th className="px-2 py-2 font-semibold">Domains</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((company) => (
                <tr key={company.id} className="border-b border-border hover:bg-surface">
                  <td className="px-2 py-1.5">
                    <Link
                      href={`/jobs/companies/${company.slug}`}
                      className="font-medium text-ink hover:text-brand"
                    >
                      {company.name}
                    </Link>
                    {company.hq_location && (
                      <span className="ml-1.5 text-ink-faint">{company.hq_location}</span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-ink-muted">{company.priority}</td>
                  <td className="px-2 py-1.5 text-ink-muted">
                    {company.status.replace(/_/g, ' ')}
                  </td>
                  <td className="tabular px-2 py-1.5 text-ink-muted">{company.roles.length}</td>
                  <td className="px-2 py-1.5 text-ink-faint">
                    {company.domains.length > 0 ? company.domains.join(', ') : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[11px] text-ink-faint">
            Domains are what let a recruiter&rsquo;s personal work address find its company. Add
            them on the company page when mail is not linking.
          </p>
        </div>
      </div>
    </>
  );
}
