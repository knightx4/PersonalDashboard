import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import { exportedFunctions, operationsReachedBy, REPO_ROOT } from './action-graph';
import { isBackgroundOperation } from './estimate';
import { OPERATION_GUESSES, type OperationName } from './guesses';
import {
  actionOf,
  estimatePaidActions,
  PAID_ACTION_KEYS,
  PAID_ACTIONS,
  PAID_WITHOUT_BUTTON,
  paidActionsUnder,
} from './paid-actions';

/**
 * The $ hints name what a press will record, and this checks that they do.
 *
 * Each server action is followed through the functions it calls to the ledger
 * writers (action-graph.ts), and what it can record is compared with what its
 * entry in PAID_ACTIONS says. The hint is priced from that same entry, so a
 * hint that passes here names the operations its press writes rows under.
 *
 * Learn's actions were walked first (plan #917); #918 added Jobs, Shopping,
 * Vault and News, and #919 widens the walk to every action in the app.
 *
 * The walker does not follow a dynamic `import()`, and it does not need to
 * here. The resale estimate reaches the model through
 * `import('@/lib/sell/web-estimate')` in lib/sell/expected-price.ts, but the
 * sell actions record that spend themselves, under their own ESTIMATE_SPEND
 * constant, so the operation is read at the action. A dynamic import that
 * hid the recording call as well would be a real gap; none does today, and
 * lib/core/spend/coverage.test.ts is what catches a model call that records
 * nothing.
 */

const KNOWN = new Set(Object.keys(OPERATION_GUESSES));
// News is walked and has no paid action: its summaries and story groups are
// made by the digest cron, which no button starts.
const WALKED = ['app/learn', 'app/jobs', 'app/shopping', 'app/vault', 'app/news'];

function files(dir: string, match: RegExp): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...files(path, match));
    else if (match.test(entry.name)) out.push(path);
  }
  return out;
}

function reached(key: string) {
  const { file, name } = actionOf(key);
  return operationsReachedBy(join(REPO_ROOT, file), name, KNOWN);
}

const foreground = (operations: Iterable<string>) =>
  [...operations].filter((op) => !isBackgroundOperation(op as OperationName)).sort();

describe('paid actions', () => {
  it('lists every walked server action that reaches a paid operation', () => {
    const listed = new Set([
      ...PAID_ACTION_KEYS.map((key) => {
        const { file, name } = actionOf(key);
        return `${file}#${name}`;
      }),
      ...Object.keys(PAID_WITHOUT_BUTTON),
    ]);
    const missing: string[] = [];
    for (const dir of WALKED) {
      for (const file of files(join(REPO_ROOT, dir), /actions\.ts$/)) {
        for (const name of exportedFunctions(file)) {
          const found = operationsReachedBy(file, name, KNOWN);
          const key = `${relative(REPO_ROOT, file)}#${name}`;
          if (foreground(found.operations).length > 0 && !listed.has(key)) {
            missing.push(`${key} (${foreground(found.operations).join(', ')})`);
          }
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it.each(PAID_ACTION_KEYS)('%s records only what its hint names', (key) => {
    const found = reached(key);
    expect(found.unread).toEqual([]);
    const named = PAID_ACTIONS[key] as readonly string[];
    expect(named.filter((op) => !found.operations.has(op))).toEqual([]);
  });

  it('names, across the buttons for one action, everything it records in the foreground', () => {
    const byAction = new Map<string, Set<string>>();
    for (const key of PAID_ACTION_KEYS) {
      const { file, name } = actionOf(key);
      const id = `${file}#${name}`;
      const named = byAction.get(id) ?? new Set<string>();
      for (const op of PAID_ACTIONS[key]) named.add(op);
      byAction.set(id, named);
    }
    const unnamed: string[] = [];
    for (const [id, named] of byAction) {
      for (const op of foreground(reached(id).operations)) {
        if (!named.has(op)) unnamed.push(`${id}: ${op}`);
      }
    }
    expect(unnamed).toEqual([]);
  });

  it('puts every press beside a button', () => {
    const sources = [
      ...files(join(REPO_ROOT, 'app'), /\.tsx$/),
      ...files(join(REPO_ROOT, 'components'), /\.tsx$/),
    ].map((path) => readFileSync(path, 'utf8'));
    const unused = PAID_ACTION_KEYS.filter(
      (key) => !sources.some((source) => source.includes(`'${key}'`) || source.includes(`"${key}"`)),
    );
    expect(unused).toEqual([]);
  });

  it('names no background operation, which no button starts', () => {
    const background = PAID_ACTION_KEYS.flatMap((key) =>
      PAID_ACTIONS[key].filter((op) => isBackgroundOperation(op)).map((op) => `${key}: ${op}`),
    );
    expect(background).toEqual([]);
  });
});

describe('estimatePaidActions', () => {
  it('prices every press from one read of the ledger', async () => {
    const calls: unknown[] = [];
    const supabase = {
      rpc: async (name: string, args: unknown) => {
        calls.push({ name, args });
        return {
          data: [
            {
              operation: 'plan-topic',
              runs: 8,
              low_micros: 100_000,
              median_micros: 200_000,
              high_micros: 400_000,
            },
          ],
          error: null,
        };
      },
    } as unknown as CoreSupabaseClient;

    const learn = paidActionsUnder('app/learn/');
    const costs = await estimatePaidActions(supabase, 'user', learn);

    expect(calls).toHaveLength(1);
    expect(Object.keys(costs).sort()).toEqual([...learn].sort());
    const plan = costs['app/learn/t/[id]/actions.ts#planTrack']!;
    // plan-topic measured, name-areas a guess: the sum is a guess.
    expect(plan.basis).toBe('guess');
    expect(plan.medianMicros).toBeGreaterThan(200_000);
    expect(costs['app/learn/new/actions.ts#resolveCandidate']!.per).toBe('unit');
  });
});
