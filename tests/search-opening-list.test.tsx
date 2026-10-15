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

const pushed = vi.hoisted((): string[] => []);

vi.mock('next/navigation', () => ({
  usePathname: () => '/todo',
  useRouter: () => ({
    push: (href: string) => pushed.push(href),
    replace: () => {},
    refresh: () => {},
  }),
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

/**
 * Every workspace's tabs, once something is typed (plan #2208.4).
 *
 * The rows come from lib/shell/tabs.ts as well as from the page's own
 * sections, so a tab of another workspace is one search away. Each row is
 * marked with the workspace that owns it.
 */
type Typed = { label: string; module: ModuleId | null; run: () => void };

function typed(
  query: string,
  {
    module = 'jobs',
    enabledModules,
    isOwner = true,
    scope = 'everything',
  }: {
    module?: ModuleId | null;
    enabledModules?: readonly ModuleId[];
    isOwner?: boolean;
    scope?: ReturnType<typeof scopeForModule>;
  } = {},
): Typed[] {
  const found: Typed[] = [];
  function TypedProbe() {
    const { rows } = useSearchRows({
      account: '11111111-1111-4111-8111-111111111111',
      module,
      scope,
      sections: module === 'jobs' ? [{ href: '/jobs/inbox', label: 'Inbox' }] : [],
      enabledModules,
      isOwner,
      theme: SYSTEM_THEME,
      query,
      active: true,
    });
    for (const row of rows) {
      if (row.kind === 'command' && row.command.hint === 'Go to') {
        found.push({
          label: row.command.label,
          module: row.command.module ?? null,
          run: row.command.run,
        });
      }
    }
    return null;
  }
  renderToStaticMarkup(
    <CaptureProvider>
      <TypedProbe />
    </CaptureProvider>,
  );
  return found;
}

describe('a tab of another workspace', () => {
  it('is found from Jobs by its name, marked Dev, and Enter opens it', () => {
    const ideas = typed('ideas').find((row) => row.label === 'Ideas');
    expect(ideas?.module).toBe('dev');
    pushed.length = 0;
    ideas?.run();
    expect(pushed).toEqual(['/dev/ideas']);
  });

  it('is found from Home too', () => {
    expect(typed('ideas', { module: null }).some((row) => row.module === 'dev')).toBe(true);
  });

  it('is not offered from a workspace that is switched off', () => {
    const rows = typed('ideas', { enabledModules: ['jobs', 'todo'] });
    expect(rows.some((row) => row.module === 'dev')).toBe(false);
  });

  it("is not Dev's, or Learn's Videos, for anyone but the owner", () => {
    expect(typed('ideas', { isOwner: false }).some((row) => row.module === 'dev')).toBe(false);
    expect(typed('videos', { isOwner: false }).some((row) => row.label === 'Videos')).toBe(false);
    expect(typed('videos').some((row) => row.label === 'Videos')).toBe(true);
  });

  it('ranks behind the same tab of the workspace you are in', () => {
    const inboxes = typed('inbox');
    expect(inboxes[0]).toMatchObject({ label: 'Inbox', module: 'jobs' });
    // Listed once, though Jobs's Inbox is both on the page and in the list.
    expect(inboxes.filter((row) => row.module === 'jobs')).toHaveLength(1);
    expect(inboxes.length).toBeGreaterThan(1);
  });

  it('is dropped when the box is narrowed to the workspace you are in', () => {
    const rows = typed('ideas', { scope: scopeForModule('jobs') });
    expect(rows.some((row) => row.module !== 'jobs')).toBe(false);
  });

  it('is not in the list before anything is typed', () => {
    const opening = typed('', { scope: scopeForModule('jobs') });
    expect(opening.map((row) => row.label)).toEqual(['Inbox']);
    expect(typed('').some((row) => row.module !== 'jobs' && row.label !== 'Account')).toBe(false);
  });
});
