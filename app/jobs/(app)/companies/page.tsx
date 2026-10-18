import { redirect } from 'next/navigation';
import { createClient, requireUser } from '@/lib/jobs/auth/server';
import { createCoreClient } from '@/lib/core/auth/server';
import { defaultViewHref, savedViewsFor } from '@/lib/saved-views/store';
import { companiesDisplay } from '@/lib/jobs/roles-display';
import { PERSPECTIVE_COLUMNS } from '@/lib/jobs/companies/perspective';
import { CompaniesPage as CompaniesView } from '@/components/jobs/companies/companies-page';
import type { CompaniesParams, CompanyRow } from '@/lib/jobs/companies-view';

export const metadata = { title: 'Companies' };

/**
 * Loads the companies and hands them to the page component, which the
 * gallery draws with fixtures (components/jobs/companies/companies-page.tsx).
 */
export default async function CompaniesPage({ searchParams }: { searchParams: Promise<CompaniesParams> }) {
  const user = await requireUser();
  const supabase = await createClient();
  const params = await searchParams;

  const savedViews = await savedViewsFor(await createCoreClient(), companiesDisplay().pathname);
  const openOn = defaultViewHref(savedViews, params);
  if (openOn) redirect(openOn);

  const [{ data }, { data: profile }] = await Promise.all([
    supabase
      .from('companies')
      .select(
        `id, name, slug, priority, status, industry, hq_location, domains, website, careers_url, logo_url, ats_type, ats_board_token, ${PERSPECTIVE_COLUMNS}, roles ( id, applications ( status ) )`,
      )
      .eq('user_id', user.id)
      .order('name'),
    supabase.from('profiles').select('timezone').eq('id', user.id).maybeSingle(),
  ]);

  return (
    <CompaniesView
      companies={(data ?? []) as unknown as CompanyRow[]}
      params={params}
      savedViews={savedViews}
      timezone={(profile?.timezone as string | undefined) ?? 'UTC'}
    />
  );
}
