import type { SearchHit } from '@/lib/search/sources';

/**
 * Rows into hits.
 *
 * Pure, and separate from the reads, so the part that is easy to get quietly
 * wrong can be tested without a database. The thing worth checking is the
 * href: a hit that leads to a route which does not exist is worse than no hit
 * at all, because it looks like the feature works right up until Enter.
 *
 * A subtitle is not decoration either. "Acme" on its own is a company, an
 * order and a saved item, and the whole point of one box for everything is
 * that it says which.
 */

/** A PostgREST embed comes back as an object or a one-element array. */
export function embedded<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export function companyHit(row: {
  id: string;
  name: string;
  slug: string | null;
  industry: string | null;
}): SearchHit {
  return {
    module: 'jobs',
    kind: 'company',
    id: row.id,
    title: row.name,
    subtitle: row.industry ? `Company · ${row.industry}` : 'Company',
    // Slug where there is one, id otherwise: the route takes either, and a
    // company added by hand may not have a slug yet.
    href: `/jobs/companies/${row.slug ?? row.id}`,
  };
}

export function roleHit(row: {
  id: string;
  title: string;
  company: { name: string } | null;
}): SearchHit {
  return {
    module: 'jobs',
    kind: 'role',
    id: row.id,
    title: row.title,
    subtitle: row.company ? `Role at ${row.company.name}` : 'Role',
    // A role is called "Staff Engineer" and is looked for by the company.
    match: row.company?.name,
    href: `/jobs/roles/${row.id}`,
  };
}

export function contactHit(row: {
  id: string;
  full_name: string;
  title: string | null;
  company: { name: string } | null;
}): SearchHit {
  const where = [row.title, row.company?.name].filter(Boolean).join(' at ');
  return {
    module: 'jobs',
    kind: 'contact',
    id: row.id,
    title: row.full_name,
    subtitle: where ? `Contact · ${where}` : 'Contact',
    match: row.company?.name,
    href: `/jobs/contacts/${row.id}`,
  };
}

export function orderHit(row: {
  id: string;
  external_order_number: string | null;
  order_date: string | null;
  merchant: { name: string } | null;
}): SearchHit {
  const name = row.merchant?.name ?? 'Order';
  return {
    module: 'shopping',
    kind: 'order',
    id: row.id,
    title: row.external_order_number ? `${name} · ${row.external_order_number}` : name,
    subtitle: row.order_date ? `Order · ${row.order_date}` : 'Order',
    match: row.merchant?.name,
    href: `/shopping/orders/${row.id}`,
  };
}

export function inventoryHit(row: {
  id: string;
  name: string;
  variant: string | null;
  status: string;
}): SearchHit {
  return {
    module: 'shopping',
    kind: 'inventory',
    id: row.id,
    title: row.variant ? `${row.name} · ${row.variant}` : row.name,
    subtitle: `Owned · ${row.status}`,
    href: `/shopping/inventory/${row.id}`,
  };
}

export function savedHit(row: {
  id: string;
  title: string;
  merchant: { name: string } | null;
}): SearchHit {
  return {
    module: 'shopping',
    kind: 'saved',
    id: row.id,
    title: row.title,
    subtitle: row.merchant ? `Saved · ${row.merchant.name}` : 'Saved',
    match: row.merchant?.name,
    href: `/shopping/saved/${row.id}`,
  };
}
