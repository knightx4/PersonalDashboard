import 'server-only';

import { assertSchemaExposed } from '@/lib/core/db/schema-errors';
import { LEARN_SCHEMA, type LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import type { Subject } from '@/lib/learn/graph/load';
import type { Graph } from '@/lib/learn/graph/model';
import type { VaultSupabaseClient } from '@/lib/vault/db/schema-name';
import {
  buildAreaGrid,
  trackTested,
  type AreaGrid,
  type GridDomain,
  type GridField,
  type GridTheme,
  type GridTrack,
} from './grid';

/**
 * Reading the rows the areas grid is built from (plan #796).
 *
 * Two clients, because the themes live in the vault's schema and a learn
 * client cannot join across to it: the placements come from
 * `learn.theme_fields` and the names and strengths from `obsidian.themes`,
 * and they are joined here by theme id. Both reads go through the session,
 * so RLS keeps each to the viewer's own rows.
 *
 * The tracks' graphs are passed in rather than read again. The Know page has
 * already loaded every one to count the tracks list, and reading them twice
 * would double the page's slowest part.
 */

/** PostgREST returns at most this many rows per request, so longer reads page. */
const PAGE = 1000;

async function readAll<T>(
  page: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as T[];
    rows.push(...batch);
    if (batch.length < PAGE) return rows;
  }
}

export type LoadedAreaGrid = {
  grid: AreaGrid;
  /**
   * The vault's themes could not be read. The grid still draws, with every
   * field's interest empty, and the page says why in place (law 2) rather
   * than letting an empty vault and a failed read look alike.
   */
  interestFailed: boolean;
};

export async function loadAreaGrid(
  learn: LearnSupabaseClient,
  vault: VaultSupabaseClient,
  tracks: { subject: Subject; graph: Graph }[],
): Promise<LoadedAreaGrid> {
  const [domainRead, fieldRead, placementRead] = await Promise.all([
    learn.from('area_domains').select('id, name, position').order('position'),
    learn.from('area_fields').select('id, domain_id, name, slug, position'),
    learn.from('subjects').select('id, field_id, domain_id, placed_at'),
  ]);
  assertSchemaExposed(domainRead.error ?? fieldRead.error ?? placementRead.error, LEARN_SCHEMA);
  if (domainRead.error) throw new Error(`Reading the domains failed: ${domainRead.error.message}`);
  if (fieldRead.error) throw new Error(`Reading the fields failed: ${fieldRead.error.message}`);
  if (placementRead.error) {
    throw new Error(`Reading where your tracks are placed failed: ${placementRead.error.message}`);
  }

  const domains: GridDomain[] = (
    (domainRead.data ?? []) as { id: string; name: string; position: number }[]
  ).map((row) => ({ id: row.id, name: row.name, position: row.position }));
  const fields: GridField[] = (
    (fieldRead.data ?? []) as {
      id: string;
      domain_id: string;
      name: string;
      slug: string;
      position: number;
    }[]
  ).map((row) => ({
    id: row.id,
    domainId: row.domain_id,
    name: row.name,
    slug: row.slug,
    position: row.position,
  }));

  type Placement = {
    id: string;
    field_id: string | null;
    domain_id: string | null;
    placed_at: string | null;
  };
  const placements = new Map(
    ((placementRead.data ?? []) as Placement[]).map((row) => [row.id, row]),
  );

  // A track not placed yet and one placed across domains both show nowhere,
  // and the page names them in one line, so one number carries both.
  let unplacedTracks = 0;
  const gridTracks: GridTrack[] = [];
  for (const { subject, graph } of tracks) {
    const placement = placements.get(subject.id);
    if (!placement?.placed_at || (!placement.field_id && !placement.domain_id)) {
      unplacedTracks += 1;
      continue;
    }
    gridTracks.push({
      name: subject.name,
      fieldId: placement.field_id,
      domainId: placement.domain_id,
      ...trackTested(graph),
    });
  }

  let themes: GridTheme[] = [];
  let interestFailed = false;
  try {
    type ThemeField = { theme_id: string; field_id: string | null; domain_id: string | null };
    type Theme = {
      id: string;
      name: string;
      strength: number | string | null;
      last_seen: string | null;
    };
    const [themeFields, vaultThemes] = await Promise.all([
      readAll<ThemeField>((from, to) =>
        learn
          .from('theme_fields')
          .select('theme_id, field_id, domain_id')
          .order('theme_id')
          .range(from, to),
      ),
      readAll<Theme>((from, to) =>
        vault.from('themes').select('id, name, strength, last_seen').order('id').range(from, to),
      ),
    ]);
    const placed = new Map(themeFields.map((row) => [row.theme_id, row]));
    // A theme with no row yet has not been through the placement pass. It is
    // left out, the same as one the pass left unplaced, because either way
    // there is no field to draw it in.
    themes = vaultThemes.flatMap((theme) => {
      const at = placed.get(theme.id);
      if (!at) return [];
      return [
        {
          name: theme.name,
          // numeric comes back from PostgREST as a string.
          strength: Number(theme.strength ?? 0),
          lastSeen: theme.last_seen,
          fieldId: at.field_id,
          domainId: at.domain_id,
        },
      ];
    });
  } catch {
    interestFailed = true;
  }

  return {
    grid: buildAreaGrid({ domains, fields, themes, tracks: gridTracks, unplacedTracks }),
    interestFailed,
  };
}
