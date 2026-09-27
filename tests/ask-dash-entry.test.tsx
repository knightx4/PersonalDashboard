/**
 * Asking Dash from any page (plan #1090): the row ⌘K offers for what was
 * typed, and the links an answer's thread draws under it.
 *
 * The row is read through a probe of the search hook, the way
 * search-opening-list.test.tsx reads the opening list, since neither box
 * shows its list in a static render.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CaptureProvider } from '@/components/shell/capture';
import { AskDashProvider, type AskSource } from '@/components/shell/ask-dash';
import { useSearchRows } from '@/components/shell/use-search-rows';
import { TalkThread } from '@/components/talk/talk-thread';
import { scopeForModule } from '@/lib/search/scope';
import { SYSTEM_THEME } from '@/lib/theme';
import type { TalkTurn } from '@/lib/talk/talk';

vi.mock('next/navigation', () => ({
  usePathname: () => '/todo',
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));

const never = () => new Promise<never>(() => {});
const SOURCE: AskSource = { ask: never, recent: never, open: never, costs: never };

function Probe({ query }: { query: string }) {
  const { rows } = useSearchRows({
    account: '11111111-1111-4111-8111-111111111111',
    module: 'todo',
    scope: scopeForModule('todo'),
    sections: [{ href: '/todo', label: 'Agenda' }],
    theme: SYSTEM_THEME,
    query,
    active: false,
    surface: 'box',
  });
  return (
    <>
      {rows
        .map((row) => (row.kind === 'command' ? `|${row.command.hint}:${row.command.label}|` : ''))
        .join('')}
    </>
  );
}

function rowsFor(query: string, withDash = true): string[] {
  const probe = <Probe query={query} />;
  const html = renderToStaticMarkup(
    <CaptureProvider>{withDash ? <AskDashProvider source={SOURCE}>{probe}</AskDashProvider> : probe}</CaptureProvider>,
  );
  return (html.match(/\|[^|]+\|/g) ?? []).map((row) => row.slice(1, -1));
}

describe('Ask Dash in ⌘K', () => {
  it('offers the typed words to Dash as the last row', () => {
    const rows = rowsFor('ebay spend');
    expect(rows.at(-1)).toBe('Ask Dash:ebay spend');
  });

  it('puts it first when the words end in a question mark', () => {
    expect(rowsFor('what did I spend on ebay?')[0]).toBe('Ask Dash:what did I spend on ebay?');
  });

  it('offers nothing before anything is typed', () => {
    expect(rowsFor('').some((row) => row.startsWith('Ask Dash'))).toBe(false);
  });

  it('draws no row where there is no sheet to open', () => {
    expect(rowsFor('ebay spend', false).some((row) => row.startsWith('Ask Dash'))).toBe(false);
  });
});

describe('an answer in the thread', () => {
  const turns: TalkTurn[] = [
    { id: 'q', role: 'user', body: 'What did I spend on eBay?', createdAt: '2026-09-27T10:00:00Z' },
    {
      id: 'a',
      role: 'assistant',
      body: 'You spent $40.00 on one order.',
      createdAt: '2026-09-27T10:00:05Z',
      citations: [{ table: 'shopping.orders', ref: 'o1', title: 'Catan lot', href: '/shopping/orders/o1' }],
    },
  ];

  it('links each row it used', () => {
    const html = renderToStaticMarkup(
      <TalkThread id="t" turns={turns} send={never} label="Ask a follow-up" />,
    );
    expect(html).toContain('href="/shopping/orders/o1"');
    expect(html).toContain('Catan lot');
  });

  it('draws a card or story thread as before, with no list of rows', () => {
    const html = renderToStaticMarkup(
      <TalkThread id="t" turns={turns.map((turn) => ({ ...turn, citations: undefined }))} send={never} label="Reply" />,
    );
    expect(html).not.toContain('What this answer used');
  });
});
