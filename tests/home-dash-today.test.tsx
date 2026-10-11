/**
 * Home's "What Dash did today" section (plan #1461): grouped by workspace,
 * Undo on every change still standing (or the sentence saying why it has
 * none), long groups folded, a thread's change linked to the row it came
 * from (plan #1518), and nothing at all on a day Dash changed nothing.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { DashTodayEntry, DashTodayGroup } from '@/lib/shell/dash-today';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/home',
  useSearchParams: () => new URLSearchParams(),
}));

const { DashTodaySection, GROUP_SHOWN } = await import('@/app/home/dash-today');

function entry(n: number, over: Partial<DashTodayEntry> = {}): DashTodayEntry {
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    surface: 'routine',
    status: 'done',
    sentence: `Dash closed step #${1400 + n}.`,
    href: `/open/public.plan_items%3A${n}`,
    at: `2026-10-03T${String(10 + n).padStart(2, '0')}:00:00Z`,
    workspace: 'dev',
    noUndo: null,
    from: null,
    ...over,
  };
}

const undo = vi.fn(async () => ({ ok: true as const }));

function render(groups: DashTodayGroup[]) {
  return renderToStaticMarkup(<DashTodaySection groups={groups} timezone="Europe/London" undo={undo} />);
}

describe('DashTodaySection', () => {
  it('lists each workspace’s changes under its name, with Undo on each and a count', () => {
    const html = render([
      { workspace: 'dev', label: 'Dev', entries: [entry(1), entry(2)] },
      {
        workspace: 'todo',
        label: 'Todo',
        entries: [entry(3, { surface: 'ask', workspace: 'todo', sentence: 'Added the todo Buy stamps.' })],
      },
    ]);
    expect(html).toContain('What Dash did today');
    expect(html).toContain('3 changes');
    expect(html).toContain('aria-label="Dev"');
    expect(html).toContain('aria-label="Todo"');
    expect(html).toContain('Dash closed step #1401.');
    expect(html).toContain('Added the todo Buy stamps.');
    expect(html.match(/>Undo</g)).toHaveLength(3);
    expect(html).not.toMatch(/Claude/);
  });

  it('links a change made in a thread to the row whose thread asked for it', () => {
    const html = render([
      {
        workspace: 'todo',
        label: 'Todo',
        entries: [
          entry(1, { surface: 'thread', workspace: 'todo', sentence: 'Added the todo Follow up.', from: '/jobs/roles/r1' }),
          entry(2, { surface: 'thread', workspace: 'todo', sentence: 'Added the todo Buy stamps.' }),
        ],
      },
    ]);
    expect(html).toContain('href="/jobs/roles/r1"');
    expect(html.match(/From your comment/g)).toHaveLength(1);
  });

  it('says an undone change was undone, with no button', () => {
    const html = render([
      { workspace: 'dev', label: 'Dev', entries: [entry(1, { status: 'undone', href: null })] },
    ]);
    expect(html).toContain('Undone');
    expect(html).not.toMatch(/>Undo</);
  });

  it('says why a change has no Undo in place of the button (plan #1571)', () => {
    const why = 'Its amount is worked out from every charge on it, so correct it on the Recurring page.';
    const html = render([
      {
        workspace: 'shopping',
        label: 'Shopping',
        entries: [entry(1, { sentence: 'Dash updated Netflix from an email.', noUndo: why })],
      },
    ]);
    expect(html).toContain('Dash updated Netflix from an email.');
    expect(html).toContain(why);
    expect(html).not.toMatch(/>Undo</);
  });

  it('folds a long group behind a count of the rest', () => {
    const entries = Array.from({ length: GROUP_SHOWN + 3 }, (_, i) => entry(i + 1));
    const html = render([{ workspace: 'dev', label: 'Dev', entries }]);
    expect(html.match(/>Undo</g)).toHaveLength(GROUP_SHOWN);
    expect(html).toContain('Show 3 more');
    expect(html).toContain(`${GROUP_SHOWN + 3} changes`);
  });

  it('is absent on a day with none', () => {
    expect(render([])).toBe('');
  });
});
