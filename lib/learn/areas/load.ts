import 'server-only';

import type { AreaDomain, AreaField } from '@/lib/learn/areas/place';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';

/**
 * The areas, as every placement call hands them to the model.
 *
 * Fields in reading order (by their domain's position, then their own), the
 * ten domains, and the ids behind each slug so a placement can be written
 * back. Signed-in accounts and the service role can both read these tables, so
 * the check, theme placement and track placement all load them here.
 */
export type Areas = {
  fields: AreaField[];
  domains: AreaDomain[];
  fieldIds: Map<string, string>;
  domainIds: Map<string, string>;
};

export async function loadAreas(learn: LearnSupabaseClient): Promise<Areas> {
  const [fieldResult, domainResult] = await Promise.all([
    learn.from('area_fields').select('id, slug, name, scope, position, domain:area_domains(name, position)'),
    learn.from('area_domains').select('id, slug, name, scope, position').order('position'),
  ]);
  if (fieldResult.error) throw new Error(`Reading the areas failed: ${fieldResult.error.message}`);
  if (domainResult.error) throw new Error(`Reading the domains failed: ${domainResult.error.message}`);

  type FieldRow = {
    id: string;
    slug: string;
    name: string;
    scope: string;
    position: number;
    domain: { name: string; position: number } | null;
  };
  const rows = ((fieldResult.data ?? []) as unknown as FieldRow[]).sort(
    (a, b) => (a.domain?.position ?? 0) - (b.domain?.position ?? 0) || a.position - b.position,
  );
  if (rows.length === 0) throw new Error('There are no areas to place into. Is 0027_areas applied?');
  const domainRows = (domainResult.data ?? []) as { id: string; slug: string; name: string; scope: string }[];

  return {
    fields: rows.map((row) => ({ slug: row.slug, name: row.name, scope: row.scope, domain: row.domain?.name ?? '' })),
    domains: domainRows.map((row) => ({ slug: row.slug, name: row.name, scope: row.scope })),
    fieldIds: new Map(rows.map((row) => [row.slug, row.id])),
    domainIds: new Map(domainRows.map((row) => [row.slug, row.id])),
  };
}
