/**
 * What Dash looked up, in the thread (plan #1438): the live lines while an
 * answer is written, and the same lines folded beneath the answer once it has
 * landed. The stream that feeds the live lines is pinned in
 * tests/ask-route.test.ts; the words in lib/talk/lookups.test.ts.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AskDashProvider, AskThread, type AskSource } from '@/components/shell/ask-dash';
import { LookupList } from '@/components/talk/lookup-lines';
import { heardLookup } from '@/lib/talk/lookups';
import type { TalkTurn } from '@/lib/talk/talk';

vi.mock('next/navigation', () => ({
  usePathname: () => '/ask',
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));

const never = () => new Promise<never>(() => {});
const SOURCE: AskSource = {
  ask: never,
  recent: never,
  open: never,
  poll: never,
  costs: never,
  label: never,
  confirm: never,
  decline: never,
  undo: never,
};

describe('the lookups in the thread', () => {
  it('lists a lookup as running the moment it is heard, and what it found once done', () => {
    const running = heardLookup([], { phase: 'started', id: 'a', index: 0, name: 'job_applications', input: {} });
    expect(renderToStaticMarkup(<LookupList lines={running} label="What Dash is looking up" />)).toContain(
      'Checking job applications…',
    );
    const done = heardLookup(running, {
      phase: 'finished',
      id: 'a',
      index: 0,
      name: 'job_applications',
      input: {},
      ok: true,
      found: 12,
    });
    const html = renderToStaticMarkup(<LookupList lines={done} label="What Dash is looking up" />);
    expect(html).toContain('Checking job applications<');
    expect(html).toContain('12 found');
  });

  it('folds a finished answer\'s lookups beneath it, closed, with the count on the fold', () => {
    const turns: TalkTurn[] = [
      { id: 'q1', role: 'user', body: 'Who have I not heard from?', createdAt: '2026-10-02T10:00:00Z' },
      {
        id: 'a1',
        role: 'assistant',
        body: 'Three companies.',
        createdAt: '2026-10-02T10:00:09Z',
        toolCalls: [
          { name: 'job_applications', input: { quiet_for_days: 30 }, result: { ok: true, rows: [{}, {}, {}] } },
          { name: 'search_mail', input: { from: 'Acme' }, result: { ok: true, matched: 0 } },
        ],
      },
    ];
    const html = renderToStaticMarkup(
      <AskDashProvider source={SOURCE}>
        <AskThread id="t" conversationRef="c" turns={turns} label="Ask a follow-up" />
      </AskDashProvider>,
    );
    const answer = html.indexOf('Three companies.');
    const fold = html.indexOf('What Dash looked up');
    expect(answer).toBeGreaterThan(-1);
    expect(fold).toBeGreaterThan(answer);
    expect(html).toContain('2 lookups');
    expect(html).toContain('3 found');
    expect(html).toContain('Searching email from “Acme”');
    expect(html).toContain('nothing found');
    expect(html).not.toMatch(/<details[^>]*open/);
    expect(html).not.toContain('Claude');
  });

  it('draws no fold for an answer that looked nothing up', () => {
    const html = renderToStaticMarkup(
      <AskDashProvider source={SOURCE}>
        <AskThread
          id="t"
          conversationRef="c"
          turns={[
            { id: 'q1', role: 'user', body: 'Hi', createdAt: '2026-10-02T10:00:00Z' },
            { id: 'a1', role: 'assistant', body: 'Hello.', createdAt: '2026-10-02T10:00:01Z' },
          ]}
          label="Ask a follow-up"
        />
      </AskDashProvider>,
    );
    expect(html).not.toContain('What Dash looked up');
  });
});
