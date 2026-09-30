import 'server-only';

import { sessionClients, type AgendaClients } from '@/lib/todo/agenda/clients';
import { goalItemHref, type GoalItemRow } from '@/lib/search/sources/goals-map';
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
 * So: collect the ids by target type first, ask each module once. Twelve
 * queries in the worst case, flat, no matter how many tasks are on the page,
 * and in practice one or two -- a page's tasks are rarely about a dozen
 * different kinds of thing at once.
 */

export interface Anchor {
  label: string;
  href: string;
}

type Row = Record<string, unknown>;

export async function resolveAnchors(
  links: TaskLink[],
  clients: AgendaClients = sessionClients,
): Promise<Map<string, Anchor>> {
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
    lookups.push(lookup(clients, target, [...ids], labels));
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
  clients: AgendaClients,
  target: LinkTarget,
  ids: string[],
  into: Map<string, Anchor>,
): Promise<void> {
  // A failed lookup costs a label, not the page. Someone whose vault token has
  // expired should still see their own list, with one row reading a little
  // barer than it might.
  try {
    if (target === 'order') {
      const supabase = await clients.shopping();
      const { data } = await supabase
        .from('orders')
        .select('id, external_order_number, merchants ( name )')
        .in('id', ids);
      for (const row of (data ?? []) as Row[]) {
        const merchant = one(row.merchants)?.name as string | undefined;
        const number = row.external_order_number as string | null;
        into.set(`order:${row.id as string}`, {
          // The same label the search puts on an order, for the same reason:
          // "Amazon" alone is a merchant, an order and a saved item.
          label: [merchant ?? 'Order', number].filter(Boolean).join(' · '),
          href: `/shopping/orders/${row.id as string}`,
        });
      }
      return;
    }

    if (target === 'inventory') {
      const supabase = await clients.shopping();
      const { data } = await supabase
        .from('inventory_items')
        .select('id, name, variant')
        .in('id', ids);
      for (const row of (data ?? []) as Row[]) {
        const variant = row.variant as string | null;
        into.set(`inventory:${row.id as string}`, {
          label: variant ? `${row.name as string} · ${variant}` : (row.name as string),
          href: `/shopping/inventory/${row.id as string}`,
        });
      }
      return;
    }

    if (target === 'saved') {
      const supabase = await clients.shopping();
      const { data } = await supabase.from('saved_items').select('id, title').in('id', ids);
      for (const row of (data ?? []) as Row[]) {
        into.set(`saved:${row.id as string}`, {
          label: row.title as string,
          href: `/shopping/saved/${row.id as string}`,
        });
      }
      return;
    }

    if (target === 'reading') {
      const supabase = await clients.learn();
      const { data } = await supabase
        .from('readings')
        .select('id, title, sources ( title )')
        .in('id', ids);
      for (const row of (data ?? []) as Row[]) {
        // A reading whose subject came from its source has a null title, the
        // same fallback lib/learn/tracks/load.ts and the search both make.
        const source = one(row.sources)?.title as string | undefined;
        into.set(`reading:${row.id as string}`, {
          label: source ?? (row.title as string | null) ?? 'Untitled',
          href: `/learn/r/${row.id as string}`,
        });
      }
      return;
    }

    if (target === 'track') {
      const supabase = await clients.learn();
      const { data } = await supabase.from('tracks').select('id, title').in('id', ids);
      for (const row of (data ?? []) as Row[]) {
        into.set(`track:${row.id as string}`, {
          label: row.title as string,
          href: `/learn/t/${row.id as string}`,
        });
      }
      return;
    }

    if (target === 'subject') {
      const supabase = await clients.learn();
      const { data } = await supabase.from('subjects').select('id, name').in('id', ids);
      for (const row of (data ?? []) as Row[]) {
        into.set(`subject:${row.id as string}`, {
          label: row.name as string,
          href: `/learn/s/${row.id as string}`,
        });
      }
      return;
    }

    if (target === 'goal') {
      // A task handed to Dash as an errand points at the errand (plan #1263),
      // and a task picked against a goal or a step points at that. Goals and
      // steps share goals.items, so goal_id holds either. A step has no page of
      // its own: it opens as a row on its goal's page, and its goal is found by
      // walking parent_id up, as the search's step hits do.
      const supabase = await clients.goals();
      const byId = new Map<string, GoalItemRow>();
      let wanted = ids;
      for (let depth = 0; wanted.length > 0 && depth < 8; depth += 1) {
        const { data } = await supabase
          .from('items')
          .select('id, level, parent_id, title, status, kind')
          .in('id', wanted);
        for (const row of (data ?? []) as GoalItemRow[]) byId.set(row.id, row);
        wanted = [
          ...new Set(
            ((data ?? []) as GoalItemRow[])
              .filter((row) => row.level !== 'goal' && row.parent_id && !byId.has(row.parent_id))
              .map((row) => row.parent_id as string),
          ),
        ];
      }
      for (const id of ids) {
        const row = byId.get(id);
        if (!row) continue;
        into.set(`goal:${id}`, { label: row.title, href: goalItemHref(row, byId) });
      }
      return;
    }

    if (target === 'note') {
      const supabase = await clients.vault();
      const { data } = await supabase.from('notes').select('id, title, path').in('id', ids);
      for (const row of (data ?? []) as Row[]) {
        into.set(`note:${row.id as string}`, {
          label: row.title as string,
          href: `/vault/n/${(row.path as string).split('/').map(encodeURIComponent).join('/')}`,
        });
      }
      return;
    }

    const supabase = await clients.jobs();

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
