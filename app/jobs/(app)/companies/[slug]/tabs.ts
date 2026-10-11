import { tabFrom } from '@/lib/tabs';

/**
 * A company page's tabs, as the values its `?tab=` address takes (the tabbed
 * sections pattern, plan #1628), in the shape of the role page's
 * (app/jobs/(app)/roles/[id]/tabs.ts), since the two are reached from each
 * other.
 *
 * It opens on Roles, the roles pursued here across cycles and what is
 * outstanding on them, which is what the page led with before it had tabs.
 * The opening tab is the same for every company, so it is left out of the
 * address and the plain link to a company is that tab.
 */
export const COMPANY_TABS = ['roles', 'about', 'people', 'outreach', 'notes'] as const;

export type CompanyTab = (typeof COMPANY_TABS)[number];

const IDS = COMPANY_TABS.map((id) => ({ id }));

/** The tab a `?tab=` value opens, Roles when it names none here. */
export function companyTabFrom(value: string | null | undefined, opensOn?: CompanyTab): CompanyTab {
  return tabFrom(value, IDS, { opensOn }) as CompanyTab;
}
