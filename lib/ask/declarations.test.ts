import { describe, expect, it } from 'vitest';
import { MODULE_IDS } from '@/lib/modules';
import { workspacesBlock } from './declaration';
import { ASK_DECLARATIONS, emptyHint } from './declarations';
import { ASK_TOOL_NAMES } from './tools';

describe('the workspaces\' declarations', () => {
  it('cover every workspace once', () => {
    expect(ASK_DECLARATIONS.map((d) => d.module).sort()).toEqual([...MODULE_IDS].sort());
  });

  it('name only tools that exist, and only hint for tools they read with', () => {
    for (const d of ASK_DECLARATIONS) {
      expect(d.holds.length).toBeGreaterThan(0);
      for (const tool of d.readWith) expect(ASK_TOOL_NAMES).toContain(tool);
      for (const tool of Object.keys(d.whenEmpty ?? {})) expect(d.readWith).toContain(tool);
    }
  });

  it('put every workspace in the prompt, with how to read it', () => {
    const block = workspacesBlock(ASK_DECLARATIONS);
    expect(block).toContain('Vault:');
    expect(block).toContain('Read with vault_notes');
    expect(block.split('\n')).toHaveLength(MODULE_IDS.length);
  });

  it('give a hint for an empty note search and none for a tool with no advice', () => {
    expect(emptyHint('vault_notes')).toContain('different wording');
    expect(emptyHint('goal_status')).toBeNull();
  });
});
