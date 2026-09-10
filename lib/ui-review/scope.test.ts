import { describe, expect, it } from 'vitest';
import { MODULE_IDS } from '@/lib/modules';
import { scopeForFile, UI_SCOPES } from '@/lib/ui-review/scope';

describe('scopeForFile', () => {
  it('puts a file in the module whose tree it is in', () => {
    expect(scopeForFile('app/vault/n/[slug]/page.tsx')).toBe('vault');
    expect(scopeForFile('app/shopping/orders/page.tsx')).toBe('shopping');
    expect(scopeForFile('components/todo/task-row.tsx')).toBe('todo');
    // Named after what it draws rather than after the workspace.
    expect(scopeForFile('components/people/person-badge.tsx')).toBe('shopping');
  });

  it('puts the shell, the primitives and the account pages in shared', () => {
    expect(scopeForFile('components/shell/app-shell.tsx')).toBe('shared');
    expect(scopeForFile('components/ui/card.tsx')).toBe('shared');
    expect(scopeForFile('app/account/view.tsx')).toBe('shared');
    expect(scopeForFile('app/layout.tsx')).toBe('shared');
  });

  it('puts a path it has never heard of in shared rather than dropping it', () => {
    expect(scopeForFile('app/whatever/page.tsx')).toBe('shared');
    expect(scopeForFile('components/whatever/thing.tsx')).toBe('shared');
  });

  it('has somewhere to put every module, so a new one is not silently shared', () => {
    for (const id of MODULE_IDS) {
      expect(UI_SCOPES).toContain(id);
      expect(scopeForFile(`app/${id}/page.tsx`)).toBe(id);
    }
  });
});
