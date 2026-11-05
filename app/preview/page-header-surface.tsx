import { PageHeader } from '@/components/shell/page-header';
import { PageColumn, PageWide } from '@/components/shell/page-width';
import { Button } from '@/components/ui/button';
import { ModuleMark } from '@/components/ui/module-mark';

/**
 * The frame every page in the shell draws (plan #2815.3): its heading,
 * the path above it with the one back link, and the two page widths.
 *
 * These four files are imported by nearly every page, so a change to one
 * reached 700 to 850 surfaces and the design check could not be got through.
 * They are in COMPONENT_SURFACES (lib/preview/routes.ts) against this
 * surface instead, which draws each state the header has: a list page with
 * a title alone, one with a line under it and three actions (which wrap on a
 * phone), a row page three parts down with its path and back link, and a
 * row's page with a mark and a title long enough to wrap. The first two sit
 * in the one-column width and the last two in the wide one, so a change to
 * either width shows here at 1280.
 */
export function PageHeaderSurface() {
  return (
    <div className="flex flex-col gap-10">
      <PageColumn>
        <PageHeader title="Saved" />
      </PageColumn>
      <PageColumn>
        <PageHeader
          subject={{ ref: null, path: [{ label: 'Jobs', href: '/jobs' }, { label: 'Roles', href: '/jobs/roles' }] }}
          title="Roles"
          description="Every role you are weighing, newest first."
          actions={
            <>
              <Button variant="secondary">Import from mail</Button>
              <Button variant="secondary">Export</Button>
              <Button>Add a role</Button>
            </>
          }
        />
      </PageColumn>
      <PageWide>
        <PageHeader
          subject={{
            ref: 'plan_item:00000000-0000-4000-8000-000000002815',
            path: [
              { label: 'Dev', href: '/dev' },
              { label: 'Plan', href: '/dev/plan' },
              { label: '#2815', href: '/dev/plan/2815' },
              { label: '#2815.3', href: '/dev/plan/2815.3' },
            ],
          }}
          title="The design check settles shared-file screens by itself"
        />
      </PageWide>
      <PageWide>
        <PageHeader
          leading={<ModuleMark module="jobs" size="lg" />}
          subject={{
            ref: 'company:00000000-0000-4000-8000-000000000042',
            path: [
              { label: 'Jobs', href: '/jobs' },
              { label: 'Companies', href: '/jobs/companies' },
              { label: 'Northwind Analytics', href: '/jobs/companies/42' },
            ],
          }}
          title="Northwind Analytics and Cartography Research Laboratories (London office)"
          description="Applied for two roles; one interview booked."
        />
      </PageWide>
    </div>
  );
}
