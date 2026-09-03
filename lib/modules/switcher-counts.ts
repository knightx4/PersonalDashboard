import { describeCount, type ModuleCounts } from '@/lib/modules/counts';
import { MODULE_IDS } from '@/lib/modules';
import type { ModuleId } from '@/lib/modules';

/**
 * Counts, flattened to strings for the switcher.
 *
 * The switcher is a client component, so it must not receive anything that
 * would drag `server-only` code into the browser bundle. Formatting here keeps
 * the boundary a plain string.
 */
export function switcherCounts(counts: ModuleCounts): Partial<Record<ModuleId, string>> {
  const out: Partial<Record<ModuleId, string>> = {};
  for (const id of MODULE_IDS) {
    const entry = counts[id];
    if (entry) out[id] = describeCount(entry);
  }
  return out;
}
