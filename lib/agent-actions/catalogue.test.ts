/**
 * Every server action under app/ is in the catalogue: done by a Dash tool,
 * listed with the reason no agent should, or listed as a gap (plan #1895,
 * lib/agent-actions/types.ts). A new action fails here until the session that
 * wrote it decides which, in its module's agent-actions.ts.
 */
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HAND_OFF_TOOL_NAME } from '@/lib/talk/handoff';
import { DASH_TOOLS } from '@/lib/dash/registry';
import { AGENT_ACTIONS, actionGaps, actionKey, entryTools } from './catalogue';
import { exportedActions, isServerModule, serverActions } from './scan';
import { NO_TOOL_REASONS } from './types';

const ROOT = join(__dirname, '..', '..');
const found = serverActions(ROOT);

describe('the catalogue of actions against app/', () => {
  it('finds the server actions', () => {
    // A scan that found nothing would pass every check below.
    expect(found.length).toBeGreaterThan(400);
  });

  it('lists every server action', () => {
    const listed = new Set(AGENT_ACTIONS.map(actionKey));
    const missing = found.map(actionKey).filter((key) => !listed.has(key));
    expect(
      missing.map(
        (key) =>
          `${key} is new: map it to the Dash tool that does the same, list it with the reason no agent should, or list it as a gap, in its module's agent-actions.ts (lib/agent-actions/types.ts).`,
      ),
    ).toEqual([]);
  });

  it('lists only actions that exist', () => {
    const present = new Set(found.map(actionKey));
    const gone = AGENT_ACTIONS.map(actionKey).filter((key) => !present.has(key));
    expect(
      gone.map((key) => `${key} is in the catalogue but not exported: remove or rename it.`),
    ).toEqual([]);
  });

  it('lists each action once', () => {
    const keys = AGENT_ACTIONS.map(actionKey);
    expect(keys.filter((key, i) => keys.indexOf(key) !== i)).toEqual([]);
  });

  it('maps only to tools Dash has, and never to the hand-off', () => {
    const names = new Set(DASH_TOOLS.map((t) => t.name));
    const wrong = AGENT_ACTIONS.flatMap((a) =>
      entryTools(a.entry)
        .filter((t) => !names.has(t) || t === HAND_OFF_TOOL_NAME)
        .map((t) => `${actionKey(a)} names ${t}`),
    );
    expect(wrong).toEqual([]);
  });

  it('gives every reason a sentence', () => {
    for (const a of AGENT_ACTIONS) {
      if ('none' in a.entry) expect(NO_TOOL_REASONS[a.entry.none], actionKey(a)).toBeTruthy();
    }
  });

  it('counts the gaps', () => {
    expect(actionGaps().length).toBe(AGENT_ACTIONS.filter((a) => 'gap' in a.entry).length);
  });
});

describe('scanning a module', () => {
  it('reads the directive past a comment', () => {
    expect(isServerModule("/** Actions. */\n'use server';\n")).toBe(true);
    expect(isServerModule('// x\n"use server";\n')).toBe(true);
    expect(isServerModule("import x from 'y';\n'use server';\n")).toBe(false);
    expect(isServerModule("'use client';\n")).toBe(false);
  });

  it('reads every form of export but types', () => {
    const source = [
      'export async function a() {}',
      'export function b() {}',
      'export const c = async () => {};',
      'export { d, e as f, type G };',
      'export type H = string;',
      'export interface I {}',
    ].join('\n');
    expect(exportedActions(source)).toEqual(['a', 'b', 'c', 'd', 'f']);
  });
});
