/**
 * What the search box lists before anybody types.
 *
 * The box was opened on purpose, so narrowed to a workspace it answers with
 * that workspace's pages and what you can start there, and with nothing from
 * any other workspace; on everything it answers with the list it has always
 * opened on.
 *
 * Rendered through a probe rather than through the box: the probe asks the
 * hook the same question the box asks it.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CaptureProvider } from '@/components/shell/capture';
import { useSearchRows } from '@/components/shell/use-search-rows';
import type { NavSection } from '@/components/shell/app-shell';
import type { ModuleId } from '@/lib/modules';
import { scopeForModule } from '@/lib/search/scope';
import { SYSTEM_THEME } from '@/lib/theme';

vi.mock('next/navigation', () => ({
  usePathname: () => '/todo',
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));

const sections: NavSection[] = [
  { href: '/todo', label: 'Agenda' },
  { href: '/todo/calendar', label: 'Calendar' },
];

function Probe({ module }: { module: ModuleId | null }) {
  const { rows } = useSearchRows({
    account: '11111111-1111-4111-8111-111111111111',
    module,
    scope: scopeForModule(module),
    sections: module === null ? [] : sections,
    theme: SYSTEM_THEME,
    query: '',
    // Nothing is fetched in a static render, and the opening list is the
    // navigation half, which never depended on a fetch.
    active: true,
  });

  return <>{rows.map((row) => (row.kind === 'command' ? `|${row.command.label}|` : '')).join('')}</>;
}

function opening(module: ModuleId | null): string[] {
  const html = renderToStaticMarkup(
    <CaptureProvider>
      <Probe module={module} />
    </CaptureProvider>,
  );
  return [...html.matchAll(/\|([^|]+)\|/g)].map((match) => match[1]);
}

describe('the box', () => {
  it('narrowed to a workspace, lists its pages and what you can start there', () => {
    expect(opening('todo')).toEqual(['Agenda', 'Calendar', 'Add a todo']);
  });

  it('narrowed, offers no other workspace, no Home, no Account and no theme', () => {
    const rows = opening('todo');
    expect(rows).not.toContain('Home');
    expect(rows).not.toContain('Account');
    expect(rows.some((row) => row.startsWith('Theme:'))).toBe(false);
    expect(rows).not.toContain('Shopping');
  });

  it('opens on everything where there is no workspace to narrow to', () => {
    const rows = opening(null);
    // The list the box has always opened with: Home, then the workspaces, up
    // to the same cap of eight. Nothing to start is added to it, because
    // there is no workspace here whose things those would be.
    expect(rows[0]).toBe('Home');
    expect(rows).toContain('Todo');
    expect(rows).toHaveLength(8);
    expect(rows).not.toContain('Add a todo');
  });
});
