/**
 * Asking Dash from any page (plan #1090): the row ⌘K offers for what was
 * typed, the links an answer's thread draws under it, and the page the sheet
 * says it will tell Dash (plan #1272).
 *
 * The row is read through a probe of the search hook, the way
 * search-opening-list.test.tsx reads the opening list, since neither box
 * shows its list in a static render.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CaptureProvider } from '@/components/shell/capture';
import {
  AskDashPanel,
  AskDashProvider,
  LookingAt,
  useAskSend,
  type AskSource,
} from '@/components/shell/ask-dash';
import { useSearchRows } from '@/components/shell/use-search-rows';
import { TalkThread } from '@/components/talk/talk-thread';
import { scopeForModule } from '@/lib/search/scope';
import { SYSTEM_THEME } from '@/lib/theme';
import type { TalkSend } from '@/components/talk/talk-thread';
import type { TalkTurn } from '@/lib/talk/talk';

vi.mock('next/navigation', () => ({
  usePathname: () => '/todo',
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));

const never = () => new Promise<never>(() => {});
const SOURCE: AskSource = {
  ask: never,
  recent: never,
  open: never,
  costs: never,
  label: never,
  confirm: never,
  decline: never,
  undo: never,
};

function Probe({ query }: { query: string }) {
  const { rows } = useSearchRows({
    account: '11111111-1111-4111-8111-111111111111',
    module: 'todo',
    scope: scopeForModule('todo'),
    sections: [{ href: '/todo', label: 'Agenda' }],
    theme: SYSTEM_THEME,
    query,
    active: false,
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

function SendProbe({ page, keep }: { page: string | null; keep: (send: TalkSend) => void }) {
  keep(useAskSend(null, page));
  return null;
}

describe('the page the sheet will tell Dash', () => {
  function panel(page: string | null): string {
    return renderToStaticMarkup(
      <AskDashProvider source={SOURCE}>
        <AskDashPanel page={page} source={SOURCE} onClose={() => {}} />
      </AskDashProvider>,
    );
  }

  it('shows the page above the question box, by its workspace until the row is read', () => {
    const html = panel('/goals/00000000-0000-4000-8000-0000000000a1');
    expect(html).toContain('Looking at: <span class="text-ink">Goals</span>');
    expect(html).not.toContain('00000000-0000-4000-8000-0000000000a1');
    expect(html).toContain('Do not tell Dash about this page');
  });

  it('shows nothing when there is no page, or on the Ask page', () => {
    expect(panel(null)).not.toContain('Looking at');
    expect(panel('/ask')).not.toContain('Looking at');
    expect(panel('/ask/00000000-0000-4000-8000-000000000009')).not.toContain('Looking at');
  });

  it('drops the page when its × is pressed', () => {
    const onDrop = vi.fn();
    const chip = LookingAt({ label: 'Trip ideas', onDrop });
    const [, button] = (chip.props as { children: React.ReactElement<{ onClick: () => void }>[] }).children;
    button.props.onClick();
    expect(onDrop).toHaveBeenCalledOnce();
  });

  /** The send function a thread gets for `page`, taken out of a render. */
  function sendFor(page: string | null, ask: AskSource['ask']): TalkSend {
    const kept: TalkSend[] = [];
    const source = { ...SOURCE, ask };
    renderToStaticMarkup(
      <AskDashProvider source={source}>
        <SendProbe page={page} keep={(send) => kept.push(send)} />
      </AskDashProvider>,
    );
    return kept[0];
  }

  it('sends the page with a question, and no page once it is dropped', async () => {
    const ask = vi.fn<AskSource['ask']>(async () => ({ turns: [] }));
    await sendFor('/goals/00000000-0000-4000-8000-0000000000a1', ask)('What is left to book?');
    await sendFor(null, ask)('And after that?');
    expect(ask.mock.calls).toEqual([
      ['What is left to book?', null, '/goals/00000000-0000-4000-8000-0000000000a1'],
      ['And after that?', null, null],
    ]);
  });
});
