import 'server-only';

import { createClient as createJobsClient } from '@/lib/jobs/auth/server';
import { createVaultClient } from '@/lib/vault/auth/server';
import { LINK_TARGETS, type LinkTarget, type TaskLink } from '@/lib/todo/links/model';

/**
 * Turning link ids into something a person can read.
 *
 * A link stores an id; the agenda needs a name -- "Acme · Staff Engineer"
 * beside the task, not a uuid. Because each module's data is read through its
 * own client, that name is a second lookup, and the obvious shape (resolve each
 * task's anchor as it renders) is a query per row. It does not look slow until
 * the list is long, which is exactly when someone notices.
 *
 * So: collect the ids by target type first, ask each module once. Six queries
 * in the worst case, flat, no matter how many tasks are on the page.
 */

export interface Anchor {
  label: string;
  href: string;
}

type Row = Record<string, unknown>;

export async function resolveAnchors(links: TaskLink[]): Promise<Map<string, Anchor>> {
  const byTarget = new Map<LinkTarget, Set<string>>();
  for (const link of links) {
    // Only the anchor is labelled. A `source` link says where a task came from,
    // which belongs on the task's own page and not in a list row.
    if (link.relation !== 'about') continue;
    const ids = byTarget.get(link.target) ?? new Set<string>();
    ids.add(link.targetId);
    byTarget.set(link.target, ids);
  }

  if (byTarget.size === 0) return new Map();

  const labels = new Map<string, Anchor>();
  const lookups: Array<Promise<void>> = [];

  for (const target of LINK_TARGETS) {
    const ids = byTarget.get(target);
    if (!ids || ids.size === 0) continue;
    lookups.push(lookup(target, [...ids], labels));
  }

  await Promise.all(lookups);

  const byTask = new Map<string, Anchor>();
  for (const link of links) {
    if (link.relation !== 'about') continue;
    const anchor = labels.get(`${link.target}:${link.targetId}`);
    if (anchor) byTask.set(link.taskId, anchor);
  }

  return byTask;
}

async function lookup(
  target: LinkTarget,
  ids: string[],
  into: Map<string, Anchor>,
): Promise<void> {
  // A failed lookup costs a label, not the page. Someone whose vault token has
  // expired should still see their own list, with one row reading a little
  // barer than it might.
  try {
    if (target === 'note') {
      const supabase = await createVaultClient();
      const { data } = await supabase.from('notes').select('id, title, path').in('id', ids);
      for (const row of (data ?? []) as Row[]) {
        into.set(`note:${row.id as string}`, {
          label: row.title as string,
          href: `/vault/n/${(row.path as string).split('/').map(encodeURIComponent).join('/')}`,
        });
      }
      return;
    }

    const supabase = await createJobsClient();

    if (target === 'company') {
      const { data } = await supabase.from('companies').select('id, name, slug').in('id', ids);
      for (const row of (data ?? []) as Row[]) {
        into.set(`company:${row.id as string}`, {
          label: row.name as string,
          href: `/jobs/companies/${row.slug as string}`,
        });
      }
      return;
    }

    if (target === 'contact') {
      const { data } = await supabase.from('contacts').select('id, full_name').in('id', ids);
      for (const row of (data ?? []) as Row[]) {
        into.set(`contact:${row.id as string}`, {
          label: row.full_name as string,
          href: `/jobs/contacts/${row.id as string}`,
        });
      }
      return;
    }

    if (target === 'role') {
      const { data } = await supabase
        .from('roles')
        .select('id, title, companies ( name )')
        .in('id', ids);
      for (const row of (data ?? []) as Row[]) {
        into.set(`role:${row.id as string}`, {
          label: withCompany(row.title as string, row.companies),
          href: `/jobs/roles/${row.id as string}`,
        });
      }
      return;
    }

    if (target === 'application') {
      // An application is a pursuit of a role, and the role is what a person
      // recognises -- so it is labelled and linked as its role.
      const { data } = await supabase
        .from('applications')
        .select('id, roles ( id, title, companies ( name ) )')
        .in('id', ids);
      for (const row of (data ?? []) as Row[]) {
        const role = one(row.roles);
        if (!role) continue;
        into.set(`application:${row.id as string}`, {
          label: withCompany(role.title as string, role.companies),
          href: `/jobs/roles/${role.id as string}`,
        });
      }
      return;
    }

    if (target === 'interview') {
      const { data } = await supabase
        .from('interviews')
        .select('id, kind, applications ( roles ( id, title, companies ( name ) ) )')
        .in('id', ids);
      for (const row of (data ?? []) as Row[]) {
        const role = one(one(row.applications)?.roles);
        if (!role) continue;
        into.set(`interview:${row.id as string}`, {
          label: `${withCompany(role.title as string, role.companies)} · ${String(row.kind).replace(/_/g, ' ')}`,
          href: `/jobs/roles/${role.id as string}?tab=interviews&interview=${row.id as string}`,
        });
      }
    }
  } catch {
    // Deliberately swallowed. See above.
  }
}

/** PostgREST returns an embedded row as an object or a one-element array. */
function one(value: unknown): Row | null {
  if (Array.isArray(value)) return (value[0] as Row) ?? null;
  return (value as Row) ?? null;
}

function withCompany(title: string, companies: unknown): string {
  const name = one(companies)?.name as string | undefined;
  return name ? `${name} · ${title}` : title;
}
