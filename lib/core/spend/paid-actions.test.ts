import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import {
  exportedFunctions,
  namedImports,
  operationsReachedBy,
  REPO_ROOT,
  serverDirective,
} from './action-graph';
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
 * What is walked is found, not listed: every file under app/, lib/ and
 * components/ that opens with 'use server', and every route handler under
 * app/. A new module's actions are walked the day they are written, and a
 * press that reaches a model without an entry here fails the gate naming
 * the action as file#export. An inline 'use server' inside a function is
 * refused outright, since the walk reads exports and would not see it.
 *
 * What the walker does not follow (action-graph.ts): method calls on
 * objects, and a dynamic `import()`. Neither hides a paid press today. The
 * resale estimate reaches the model through
 * `import('@/lib/sell/web-estimate')` in lib/sell/expected-price.ts, but the
 * sell actions record that spend themselves, under their own ESTIMATE_SPEND
 * constant, so the operation is read at the action. A dynamic import that
 * hid the recording call as well would be a real gap, and
 * lib/core/spend/coverage.test.ts is what catches a model call that records
 * nothing.
 *
 * A page that spends while it renders is not walked, since it is no press;
 * the one there is (the order form reading an email) is registered by hand.
 */

const KNOWN = new Set(Object.keys(OPERATION_GUESSES));
const HINT_FILE = join(REPO_ROOT, 'components/ui/paid-hint.tsx');

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

const SOURCES = ['app', 'lib', 'components'].flatMap((dir) =>
  files(join(REPO_ROOT, dir), /\.tsx?$/).filter((file) => !/\.test\.tsx?$/.test(file)),
);
const DECLARING = SOURCES.filter((file) => readFileSync(file, 'utf8').includes('use server'));

/** Every file whose exports a browser can call: server actions and route handlers. */
const WALKED = [
  ...DECLARING.filter((file) => serverDirective(file) === 'file'),
  ...files(join(REPO_ROOT, 'app'), /^route\.ts$/),
].sort();

function reached(key: string) {
  const { file, name } = actionOf(key);
  return operationsReachedBy(join(REPO_ROOT, file), name, KNOWN);
}

const foreground = (operations: Iterable<string>) =>
  [...operations].filter((op) => !isBackgroundOperation(op as OperationName)).sort();

describe('paid actions', () => {
  it('walks every server action in the app', () => {
    const inline = DECLARING.filter((file) => serverDirective(file) === 'inline').map((file) =>
      relative(REPO_ROOT, file),
    );
    expect(
      inline,
      "An inline 'use server' is not walked for paid work. Move the action into a 'use server' file.",
    ).toEqual([]);
    // Every module with actions, the dev pages and the account page among them.
    const dirs = new Set(WALKED.map((file) => relative(REPO_ROOT, file).split('/').slice(0, 2).join('/')));
    for (const dir of ['app/learn', 'app/jobs', 'app/shopping', 'app/vault', 'app/dev', 'app/account', 'app/api']) {
      expect(dirs).toContain(dir);
    }
  });

  it('lists every server action and route handler that reaches a paid operation', () => {
    const listed = new Set([
      ...PAID_ACTION_KEYS.map((key) => {
        const { file, name } = actionOf(key);
        return `${file}#${name}`;
      }),
      ...Object.keys(PAID_WITHOUT_BUTTON),
    ]);
    const missing: string[] = [];
    for (const file of WALKED) {
      for (const name of exportedFunctions(file)) {
        const found = operationsReachedBy(file, name, KNOWN);
        const key = `${relative(REPO_ROOT, file)}#${name}`;
        if (foreground(found.operations).length > 0 && !listed.has(key)) {
          missing.push(`${key} (${foreground(found.operations).join(', ')})`);
        }
      }
    }
    expect(
      missing,
      'These reach a paid model call with no $ hint. Add each to PAID_ACTIONS in lib/core/spend/paid-actions.ts with the operations it records, and put a <PaidHint> for it beside its button (or add it to PAID_WITHOUT_BUTTON with the reason there is none)',
    ).toEqual([]);
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

  it('puts every press beside a button that shows its hint', () => {
    // A key counts as shown where a component names it and renders PaidHint,
    // itself or through a component it imports that does (the YouTube Press
    // takes the key as `cost` and hands it on). A layout listing keys to
    // price them does not count: it renders the provider, not a hint.
    const rendersHint = (file: string) =>
      [...namedImports(file).values()].some(
        (target) => target.file === HINT_FILE && target.name === 'PaidHint',
      );
    const components = SOURCES.filter((file) => file.endsWith('.tsx'));
    const showing = components.filter(
      (file) =>
        rendersHint(file) ||
        [...namedImports(file).values()].some((target) => rendersHint(target.file)),
    );
    const sources = showing.map((path) => readFileSync(path, 'utf8'));
    const unshown = PAID_ACTION_KEYS.filter(
      (key) => !sources.some((source) => source.includes(`'${key}'`) || source.includes(`"${key}"`)),
    );
    expect(unshown, 'No component that renders PaidHint names these').toEqual([]);
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
