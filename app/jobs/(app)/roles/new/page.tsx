import { createClient, requireUser } from '@/lib/jobs/auth/server';
import { PageHeader } from '@/components/shell/page-header';
import { RoleForm } from './role-form';
import { referrerOptions } from '@/lib/jobs/contacts/referrers';

export const metadata = { title: 'Add a role' };

export default async function NewRolePage() {
  const user = await requireUser();
  const supabase = await createClient();

  const [{ data: companies }, { data: contacts }] = await Promise.all([
    supabase.from('companies').select('name').eq('user_id', user.id).order('name'),
    supabase
      .from('contacts')
      .select('id, full_name, companies ( name )')
      .eq('user_id', user.id)
      .order('full_name'),
  ]);

  return (
    // A single form, so the form column rather than the reading column.
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Add a role"
        description="Paste a link and it fills itself in. Paste the description if it cannot."
      />
      <RoleForm
        companies={(companies ?? []).map((c) => ({ name: c.name as string }))}
        contacts={referrerOptions(contacts ?? [])}
      />
    </div>
  );
}
