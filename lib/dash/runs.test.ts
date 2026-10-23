import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AGENT_ACTIONS, entryTools } from '@/lib/agent-actions/catalogue';
import { functionsReachedBy, functionsReachedFrom, REPO_ROOT, writeToolEntries } from '@/lib/core/spend/action-graph';
import { dashToolsOf } from './registry';
import type { DashButtonMatch } from './runs';
import { DRIFTED_BUTTONS, driftedPairs } from './runs-drift';

/**
 * Each free write tool does what its buttons do by calling what they call
 * (plan #2473.1, lib/dash/runs.ts).
 *
 * A tool's code is found where it is declared under lib/dash
 * (writeToolEntries in lib/core/spend/action-graph.ts), and from its `via`
 * when it runs in a thread or the capture box. Each button's server action is
 * walked the same way. Both have to reach the function a pair names. The
 * pairs that do not yet are in ./runs-drift.ts, which this holds to the
 * truth in both directions: a pair that starts to hold has to come off the
 * list, and the `dash-tools-off-their-button` counter in
 * scripts/spec-counts.ts keeps the list from growing.
 */

const WRITE = dashToolsOf('write');
const DASH_DIR = join(REPO_ROOT, 'lib/dash');
const KEY = /^[\w\-./()[\]]+\.tsx?#\w+$/;

/** Where the person's buttons are not: Ask and the capture box run the tools themselves. */
const NOT_A_BUTTON = /^app\/(ask\/|capture-actions\.ts#)|^app\/goals\/capture-actions\.ts#fileGoalCapture$/;

function fileOf(key: string): { file: string; name: string } {
  const [file, name] = key.split('#') as [string, string];
  return { file: join(REPO_ROOT, file), name };
}

const DECLARED = new Map<string, Set<string>>();
for (const entry of readdirSync(DASH_DIR)) {
  if (!entry.endsWith('.ts') || entry.endsWith('.test.ts')) continue;
  const file = join(DASH_DIR, entry);
  for (const [tool, nodes] of writeToolEntries(file)) {
    const reached = DECLARED.get(tool) ?? new Set<string>();
    for (const node of nodes) for (const fn of functionsReachedFrom(file, node)) reached.add(fn);
    DECLARED.set(tool, reached);
  }
}

/** Every function the tool's own code can call. */
function reachedByTool(tool: (typeof WRITE)[number]): Set<string> {
  const reached = new Set(DECLARED.get(tool.name) ?? []);
  if ('via' in tool.runs && tool.runs.via) {
    const { file, name } = fileOf(tool.runs.via);
    for (const fn of functionsReachedBy(file, name)) reached.add(fn);
  }
  return reached;
}

const buttonsOf = (tool: (typeof WRITE)[number]): readonly DashButtonMatch[] =>
  'buttons' in tool.runs ? tool.runs.buttons : [];

describe('which button each free tool matches', () => {
  it('has a runs or a reason on every write tool', () => {
    expect(WRITE.length).toBeGreaterThan(100);
    for (const tool of WRITE) {
      const runs = tool.runs as unknown;
      expect(runs, `${tool.name} has neither runs nor none`).toBeTruthy();
      if ('none' in tool.runs) {
        expect(tool.runs.none.trim().length, `${tool.name} gives no reason`).toBeGreaterThan(10);
      } else {
        expect(tool.runs.buttons.length, `${tool.name} names no button`).toBeGreaterThan(0);
        for (const { action, calls } of tool.runs.buttons) {
          for (const key of [action, calls]) {
            expect(key, `${tool.name}: ${key} is not file#export`).toMatch(KEY);
            expect(existsSync(fileOf(key).file), `${tool.name}: ${key} names no file`).toBe(true);
          }
          expect(action, `${tool.name}: ${action} is not a button`).not.toMatch(NOT_A_BUTTON);
        }
      }
    }
  });

  it('finds the code of every write tool', () => {
    const lost = WRITE.filter(
      (tool) => buttonsOf(tool).length > 0 && !DECLARED.has(tool.name) && !('via' in tool.runs && tool.runs.via),
    );
    expect(lost.map((tool) => tool.name)).toEqual([]);
  });

  it('lists every button the catalogue says a write tool does', () => {
    const missing: string[] = [];
    for (const tool of WRITE) {
      const named = new Set(buttonsOf(tool).map((button) => button.action));
      for (const action of AGENT_ACTIONS) {
        const key = `${action.file}#${action.name}`;
        if (entryTools(action.entry).includes(tool.name) && !NOT_A_BUTTON.test(key) && !named.has(key)) {
          missing.push(`${tool.name} ${key}`);
        }
      }
    }
    expect(missing, 'lib/agent-actions says these buttons do what the tool does; add each to its runs').toEqual([]);
  });

  it.each(WRITE.filter((tool) => buttonsOf(tool).length > 0).map((tool) => [tool.name, tool] as const))(
    '%s and its buttons reach the same functions',
    (_name, tool) => {
      const mine = reachedByTool(tool);
      const listed = new Set(DRIFTED_BUTTONS[tool.name] ?? []);
      for (const { action, calls } of buttonsOf(tool)) {
        const { file, name } = fileOf(action);
        expect(functionsReachedBy(file, name), `${action} does not call ${calls}`).toContain(calls);
        if (listed.has(action)) {
          expect(mine.has(calls), `${tool.name} now calls ${calls}: take ${action} off its list in lib/dash/runs-drift.ts`).toBe(false);
        } else {
          expect(mine.has(calls), `${tool.name} does not call ${calls}, which ${action} does`).toBe(true);
        }
      }
    },
  );

  it('lists only pairs that are there', () => {
    const pairs = new Set(WRITE.flatMap((tool) => buttonsOf(tool).map((button) => `${tool.name} ${button.action}`)));
    expect(driftedPairs().filter((pair) => !pairs.has(pair))).toEqual([]);
  });

  it.skipIf(!process.env.RUNS_SURVEY)('writes what drifts today', () => {
    const out: Record<string, string[]> = {};
    for (const tool of WRITE) {
      const mine = reachedByTool(tool);
      const off = buttonsOf(tool).filter((button) => !mine.has(button.calls)).map((button) => button.action);
      if (off.length) out[tool.name] = off;
    }
    writeFileSync(process.env.RUNS_SURVEY!, JSON.stringify(out, null, 2));
  });
});
