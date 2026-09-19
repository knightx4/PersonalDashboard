/**
 * What each search box lists before anybody types.
 *
 * The two boxes draw from one hook and want opposite things from it. The bar
 * is on screen all the time, so having the cursor in it is not yet a question
 * and it answers with nothing. The box was opened on purpose, so it answers
 * with this workspace's pages and what you can start here, and with nothing
 * from any other workspace.
 *
 * Rendered through a probe rather than through either box: the bar hides its
 * list until the field has the cursor and the box does not exist until the
 * shortcut opens it, and neither of those can happen without a browser. The
 * probe asks the hook the same question both of them ask it.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CaptureProvider } from '@/components/shell/capture';
import {
  useSearchRows,
  type SearchSurface,
} from '@/components/shell/use-search-rows';
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

function Probe({ module, surface }: { module: ModuleId | null; surface: SearchSurface }) {
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
    surface,
  });

  return <>{rows.map((row) => (row.kind === 'command' ? `|${row.command.label}|` : '')).join('')}</>;
}

function opening(module: ModuleId | null, surface: SearchSurface): string[] {
  const html = renderToStaticMarkup(
    <CaptureProvider>
      <Probe module={module} surface={surface} />
    </CaptureProvider>,
  );
  return [...html.matchAll(/\|([^|]+)\|/g)].map((match) => match[1]);
}

describe('the bar', () => {
  it('lists nothing until a character is typed', () => {
    expect(opening('todo', 'bar')).toEqual([]);
  });

  it('lists nothing outside a workspace either', () => {
    expect(opening(null, 'bar')).toEqual([]);
  });
});

describe('the box', () => {
  it('opens on this workspace’s pages and what you can start here', () => {
    expect(opening('todo', 'box')).toEqual(['Agenda', 'Calendar', 'Add a todo']);
  });

  it('offers no other workspace, no Home, no Account and no theme', () => {
    const rows = opening('todo', 'box');
    expect(rows).not.toContain('Home');
    expect(rows).not.toContain('Account');
    expect(rows.some((row) => row.startsWith('Theme:'))).toBe(false);
    expect(rows).not.toContain('Shopping');
  });

  it('opens on everything where there is no workspace to narrow to', () => {
    const rows = opening(null, 'box');
    // The list the box has always opened with: Home, then the workspaces, up
    // to the same cap of eight. Nothing to start is added to it, because
    // there is no workspace here whose things those would be.
    expect(rows[0]).toBe('Home');
    expect(rows).toContain('Todo');
    expect(rows).toHaveLength(8);
    expect(rows).not.toContain('Add a todo');
  });
});
