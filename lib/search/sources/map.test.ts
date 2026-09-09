import { describe, expect, it } from 'vitest';
import {
  companyHit,
  contactHit,
  embedded,
  inventoryHit,
  orderHit,
  roleHit,
  savedHit,
} from './map';

/**
 * Rows into hits, for all six kinds.
 *
 * The href is the thing worth checking. A hit leading to a route that does not
 * exist is worse than no hit at all, because the feature looks like it works
 * right up until Enter -- and it is exactly the kind of mistake that survives
 * a review, since a wrong path reads the same as a right one.
 */

describe('a PostgREST embed', () => {
  it('reads the same whether it arrives as an object or a list', () => {
    expect(embedded({ name: 'Acme' })).toEqual({ name: 'Acme' });
    expect(embedded([{ name: 'Acme' }])).toEqual({ name: 'Acme' });
    expect(embedded([])).toBeNull();
    expect(embedded(null)).toBeNull();
  });
});

describe('the job search kinds', () => {
  it('maps a company to its page', () => {
    const hit = companyHit({ id: 'c1', name: 'Acme', slug: 'acme', industry: 'Robotics' });
    expect(hit).toMatchObject({
      module: 'jobs',
      kind: 'company',
      title: 'Acme',
      subtitle: 'Company · Robotics',
      href: '/jobs/companies/acme',
    });
  });

  it('falls back to the id for a company with no slug', () => {
    // One added by hand may not have one, and a href of
    // /jobs/companies/undefined is the failure this test exists for.
    expect(companyHit({ id: 'c1', name: 'Acme', slug: null, industry: null }).href).toBe(
      '/jobs/companies/c1',
    );
  });

  it('maps a role, and makes it findable by its company', () => {
    const hit = roleHit({ id: 'r1', title: 'Staff Engineer', company: { name: 'Acme' } });
    expect(hit).toMatchObject({
      kind: 'role',
      title: 'Staff Engineer',
      subtitle: 'Role at Acme',
      match: 'Acme',
      href: '/jobs/roles/r1',
    });
  });

  it('maps a role whose company is missing', () => {
    const hit = roleHit({ id: 'r1', title: 'Staff Engineer', company: null });
    expect(hit.subtitle).toBe('Role');
    expect(hit.match).toBeUndefined();
  });

  it('maps a contact with where they are', () => {
    const hit = contactHit({
      id: 'p1',
      full_name: 'Dana Reed',
      title: 'Head of Platform',
      company: { name: 'Acme' },
    });
    expect(hit).toMatchObject({
      kind: 'contact',
      title: 'Dana Reed',
      subtitle: 'Contact · Head of Platform at Acme',
      href: '/jobs/contacts/p1',
    });
  });

  it('maps a contact with nothing but a name', () => {
    const hit = contactHit({ id: 'p1', full_name: 'Dana Reed', title: null, company: null });
    expect(hit.subtitle).toBe('Contact');
  });
});

describe('the shopping kinds', () => {
  it('maps an order by merchant and number', () => {
    const hit = orderHit({
      id: 'o1',
      external_order_number: '112-4455',
      order_date: '2026-08-01',
      merchant: { name: 'Amazon' },
    });
    expect(hit).toMatchObject({
      module: 'shopping',
      kind: 'order',
      title: 'Amazon · 112-4455',
      subtitle: 'Order · 2026-08-01',
      href: '/shopping/orders/o1',
    });
  });

  it('maps an order with no number and no merchant', () => {
    const hit = orderHit({
      id: 'o1',
      external_order_number: null,
      order_date: null,
      merchant: null,
    });
    expect(hit.title).toBe('Order');
    expect(hit.subtitle).toBe('Order');
  });

  it('maps something you own, with its variant', () => {
    const hit = inventoryHit({ id: 'i1', name: 'Kettle', variant: 'Black', status: 'owned' });
    expect(hit).toMatchObject({
      kind: 'inventory',
      title: 'Kettle · Black',
      subtitle: 'Owned · owned',
      href: '/shopping/inventory/i1',
    });
  });

  it('maps something you own with no variant', () => {
    expect(inventoryHit({ id: 'i1', name: 'Kettle', variant: null, status: 'owned' }).title).toBe(
      'Kettle',
    );
  });

  it('maps a saved item, findable by where it is from', () => {
    const hit = savedHit({ id: 's1', title: 'Standing desk', merchant: { name: 'Fully' } });
    expect(hit).toMatchObject({
      kind: 'saved',
      title: 'Standing desk',
      subtitle: 'Saved · Fully',
      match: 'Fully',
      href: '/shopping/saved/s1',
    });
  });
});
