import 'server-only';

import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import type { VaultSupabaseClient } from '@/lib/vault/db/schema-name';
import { sortPlacedThemes, type PlaceTarget, type PlacedTheme } from './move';

/**
 * The themes placed in one opened place, with why each is there (plan #797).
 *
 * Read for the opened place only. The grid itself needs every theme's
 * strength but none of the reasons, so `grid-load.ts` leaves the basis out
 * and this reads it for the one field, domain or unplaced list on screen.
 * The names come from the vault's schema, which a learn client cannot join
 * to, so the two reads are joined here by theme id.
 */

/** Ids per vault request. A hundred uuids keep the query string short. */
const CHUNK = 100;

type Row = {
  id: string;
  theme_id: string;
  field_id: string | null;
  domain_id: string | null;
  runner_up_id: string | null;
  basis: string;
  moved_by_hand: boolean;
};

export async function loadPlacedThemes(
  learn: LearnSupabaseClient,
  vault: VaultSupabaseClient,
  target: PlaceTarget,
): Promise<PlacedTheme[]> {
  let query = learn
    .from('theme_fields')
    .select('id, theme_id, field_id, domain_id, runner_up_id, basis, moved_by_hand');
  if (target.fieldId) query = query.eq('field_id', target.fieldId);
  else if (target.domainId) query = query.eq('domain_id', target.domainId).is('field_id', null);
  else query = query.is('field_id', null).is('domain_id', null);

  // The largest field held 138 themes in September 2026, well under a page.
  const { data, error } = await query.limit(1000);
  if (error) throw new Error(`Reading the themes placed here failed: ${error.message}`);
  const rows = (data ?? []) as Row[];

  const names = new Map<string, { name: string; strength: number }>();
  for (let from = 0; from < rows.length; from += CHUNK) {
    const ids = rows.slice(from, from + CHUNK).map((row) => row.theme_id);
    const read = await vault.from('themes').select('id, name, strength').in('id', ids);
    if (read.error) throw new Error(`Reading the themes' names failed: ${read.error.message}`);
    for (const theme of (read.data ?? []) as {
      id: string;
      name: string;
      strength: number | string | null;
    }[]) {
      // numeric comes back from PostgREST as a string.
      names.set(theme.id, { name: theme.name, strength: Number(theme.strength ?? 0) });
    }
  }

  return sortPlacedThemes(
    rows.flatMap((row) => {
      const theme = names.get(row.theme_id);
      if (!theme) return [];
      return [
        {
          placementId: row.id,
          name: theme.name,
          strength: theme.strength,
          basis: row.basis,
          runnerUpId: row.runner_up_id,
          movedByHand: row.moved_by_hand,
          target: { fieldId: row.field_id, domainId: row.domain_id },
        },
      ];
    }),
  );
}
