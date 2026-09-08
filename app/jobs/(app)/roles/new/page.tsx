import { createClient, requireUser } from '@/lib/jobs/auth/server';
import { PageHeader } from '@/components/shell/page-header';
import { RoleForm } from './role-form';

export const metadata = { title: 'Add a role' };

export default async function NewRolePage() {
  const user = await requireUser();
  const supabase = await createClient();

  const { data: companies } = await supabase
    .from('companies')
    .select('name')
    .eq('user_id', user.id)
    .order('name');

  return (
    // A single form, so the form column rather than the reading column.
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Add a role"
        description="Paste a link and it fills itself in. Paste the description if it cannot."
      />
      <RoleForm companies={(companies ?? []).map((c) => ({ name: c.name as string }))} />
    </div>
  );
}
