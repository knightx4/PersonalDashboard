import type { SupabaseClient } from '@supabase/supabase-js';
import { MODULES, type ModuleId } from '@/lib/modules';
import { pageUsage, type PageOpens } from '@/lib/usage/opens';

/**
 * What the Usage tab in Dev shows (plan #1482): every page's opens, the pages
 * not opened in 30 days first, then the rest grouped by workspace with that
 * workspace's model spend beside it.
 *
 * Spend is per workspace, not per page. core.model_spend records the
 * workspace a call was made for and what it was doing, never the page it was
 * made from, and most calls run from a cron or a routine that has no page at
 * all. Ledger rows filed under `core` (Ask Dash, the timeline, the inbox)
 * belong to no workspace and sit with the pages outside one.
 */

/** Spend in micro-dollars, from core.workspace_spend. */
export type WorkspaceSpend = {
  /** The ledger's `module`: a workspace id, or `core` for the app as a whole. */
  module: string;
  spend7: number;
  spend30: number;
  calls30: number;
  /** Calls whose model had no published rate, so the sums are short by them. */
  unpriced30: number;
};

export type UsageGroup = {
  /** null for the pages outside any workspace (/home, /ask, /timeline). */
  workspace: ModuleId | null;
  label: string;
  opens7: number;
  opens30: number;
  lastOpened: string | null;
  /** null when nothing was spent for this group in 30 days. */
  spend: WorkspaceSpend | null;
  /** The group's pages opened in the last 30 days, most opened first. */
  pages: PageOpens[];
  /** How many of the group's pages are in the "Not opened" list instead. */
  notOpened: number;
};

export type UsageReport = {
  /** Pages not opened in 30 days, never opened first, then longest ago. */
  notOpened: PageOpens[];
  groups: UsageGroup[];
  /** Whether any page has ever been opened; false until the first view lands. */
  anyOpens: boolean;
};

type SpendRow = {
  module: string;
  spend_7: number | string;
  spend_30: number | string;
  calls_30: number;
  unpriced_30: number;
};

/**
 * Spend per workspace over the last 30 days. Pass the request's own client
 * and the view's RLS keeps it to the signed-in person.
 */
export async function readWorkspaceSpend(client: SupabaseClient): Promise<WorkspaceSpend[]> {
  const { data, error } = await client
    .schema('core')
    .from('workspace_spend')
    .select('module, spend_7, spend_30, calls_30, unpriced_30');
  if (error) throw new Error(`Could not read the spend per workspace: ${error.message}`);
  return ((data ?? []) as SpendRow[]).map((row) => ({
    module: row.module,
    spend7: Number(row.spend_7),
    spend30: Number(row.spend_30),
    calls30: row.calls_30,
    unpriced30: row.unpriced_30,
  }));
}

const OUTSIDE = 'Outside a workspace';

function spendKey(workspace: ModuleId | null): string {
  return workspace ?? 'core';
}

/** The later of two ISO times, either of which may be missing. */
function later(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return a > b ? a : b;
}

/**
 * Builds the tab from the pages that have been opened and the spend. Every
 * page in the app appears once: under "Not opened" when it has no opens in
 * 30 days, otherwise under its workspace. Workspaces come in the order the
 * switcher lists them, the pages outside one last. A workspace that is only
 * spend, with no page of its own (a ledger module that is not a workspace),
 * is still shown so no spend goes missing.
 */
export function usageReport(opened: readonly PageOpens[], spend: readonly WorkspaceSpend[]): UsageReport {
  const pages = pageUsage(opened);
  const notOpened = pages.filter((page) => page.opens30 === 0);

  const spendBy = new Map<string, WorkspaceSpend>();
  for (const row of spend) {
    const had = spendBy.get(row.module);
    spendBy.set(
      row.module,
      had
        ? {
            module: row.module,
            spend7: had.spend7 + row.spend7,
            spend30: had.spend30 + row.spend30,
            calls30: had.calls30 + row.calls30,
            unpriced30: had.unpriced30 + row.unpriced30,
          }
        : { ...row },
    );
  }

  const order: { workspace: ModuleId | null; label: string }[] = [
    ...MODULES.map((module) => ({ workspace: module.id as ModuleId | null, label: module.label })),
    { workspace: null, label: OUTSIDE },
  ];

  const groups: UsageGroup[] = order.map(({ workspace, label }) => {
    const mine = pages.filter((page) => page.workspace === workspace);
    const used = mine.filter((page) => page.opens30 > 0);
    return {
      workspace,
      label,
      opens7: mine.reduce((sum, page) => sum + page.opens7, 0),
      opens30: mine.reduce((sum, page) => sum + page.opens30, 0),
      lastOpened: mine.reduce<string | null>((last, page) => later(last, page.lastOpened), null),
      spend: spendBy.get(spendKey(workspace)) ?? null,
      pages: used,
      notOpened: mine.length - used.length,
    };
  });

  const known = new Set(order.map(({ workspace }) => spendKey(workspace)));
  for (const row of spendBy.values()) {
    if (known.has(row.module)) continue;
    groups.push({
      workspace: null,
      label: row.module,
      opens7: 0,
      opens30: 0,
      lastOpened: null,
      spend: row,
      pages: [],
      notOpened: 0,
    });
  }

  return {
    notOpened,
    groups: groups.filter((group) => group.pages.length > 0 || group.notOpened > 0 || group.spend),
    anyOpens: opened.length > 0,
  };
}

/** "today", "yesterday", "12 days ago", or "never". */
export function openedText(iso: string | null, now: Date = new Date()): string {
  if (iso === null) return 'never';
  const days = Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000);
  if (days < 1) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}
