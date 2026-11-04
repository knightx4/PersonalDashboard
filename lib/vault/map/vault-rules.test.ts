import { describe, expect, it } from 'vitest';
import { DEFAULT_VAULT_RULES, whyNotRead } from './rules';
import { loadVaultRules, rulesFromRow } from './vault-rules';

const note = (path: string, body = 'A long enough body.') => ({ path, body });

describe('whyNotRead with the person\'s own folders', () => {
  const rules = { journalFolders: ['Diary'], excludedFolders: ['Work/Applications'] };

  it('refuses notes in their journal and left-out folders, ignoring case', () => {
    expect(whyNotRead(note('diary/2026-10-01.md'), rules)?.reason).toBe('journal');
    expect(whyNotRead(note('Work/Applications/Northwind.md'), rules)?.reason).toBe('excluded');
  });

  it('reads the rest, including a folder the defaults would have refused', () => {
    expect(whyNotRead(note('Work/Notes.md'), rules)).toBeNull();
    expect(whyNotRead(note('Me/About.md'), rules)).toBeNull();
    expect(whyNotRead(note('Me/About.md'))?.reason).toBe('journal');
  });

  it('still refuses a note holding a key, whatever the folders', () => {
    expect(whyNotRead(note('Work/Notes.md', 'token sk-ant-abc'), rules)?.reason).toBe('credential');
  });
});

describe('loadVaultRules', () => {
  const client = (result: unknown) =>
    ({
      schema: () => ({
        from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => result }) }) }),
      }),
    }) as never;

  it('reads the connection row', async () => {
    const rules = await loadVaultRules(
      client({ data: { journal_folders: ['Diary'], excluded_folders: [] }, error: null }),
      'u1',
    );
    expect(rules).toEqual({ journalFolders: ['Diary'], excludedFolders: [] });
  });

  it('falls back to the defaults with no connection, a failed read, or a bad row', async () => {
    expect(await loadVaultRules(client({ data: null, error: null }), 'u1')).toEqual(DEFAULT_VAULT_RULES);
    expect(await loadVaultRules(client({ data: null, error: { message: 'down' } }), 'u1')).toEqual(
      DEFAULT_VAULT_RULES,
    );
    expect(rulesFromRow({ journal_folders: 'Me', excluded_folders: null })).toEqual(DEFAULT_VAULT_RULES);
  });
});
