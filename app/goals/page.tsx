import { Flag } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { assertSchemaExposed } from '@/lib/core/db/schema-errors';
import { createGoalsClient } from '@/lib/goals/auth/server';
import { GOALS_SCHEMA } from '@/lib/goals/db/schema-name';

export const metadata = { title: 'Goals' };
export const dynamic = 'force-dynamic';

/**
 * The Goals home (plan #923). Empty until areas and goals can be added (#924);
 * the next few things per goal arrive with #926.
 *
 * It still reads the schema, so a deployment where `goals` is not exposed to
 * PostgREST says so here instead of showing an empty page that looks right.
 */
export default async function GoalsPage() {
  const client = await createGoalsClient();
  const { count, error } = await client
    .from('items')
    .select('id', { count: 'exact', head: true })
    .eq('level', 'goal')
    .is('archived_at', null);
  assertSchemaExposed(error, GOALS_SCHEMA);
  if (error) throw new Error(`Could not read goals: ${error.message}`);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Goals"
        description="What you are working towards, and the next few things to do on each."
      />
      {count ? (
        <p className="text-body text-ink-muted">
          {count === 1 ? 'One goal' : `${count} goals`} so far.
        </p>
      ) : (
        <EmptyState
          icon={Flag}
          title="No goals yet"
          description="Your areas and goals will be listed here, with the next few things to do on each."
        />
      )}
    </div>
  );
}
