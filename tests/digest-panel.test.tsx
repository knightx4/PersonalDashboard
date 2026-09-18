/**
 * What the morning summary on Dash draws.
 *
 * The card it used to draw beneath itself, "Worth a look", is gone: #623
 * settled that what the night notices becomes ideas, so the attention list on
 * the stored summary is no longer read here. The night still writes it, which
 * is why the fixture below carries one -- a panel that only passed because
 * nothing was stored would not be testing anything.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Digest } from '@/lib/digest/load';

const { DigestPanel } = await import('@/app/dev/raised/digest-panel');

function digest(over: Partial<Digest> = {}): Digest {
  return {
    id: 'a3f0c2d1-0000-4000-8000-000000000001',
    day: '2026-09-17',
    since: '2026-09-16T04:00:00Z',
    summary: 'A quiet day: one step closed on Dash.',
    happened: [
      {
        kind: 'step',
        at: '2026-09-17T02:11:00Z',
        ref: '#628',
        title: 'Approve a proposal, or all of them, on Dash',
        note: null,
        commit: 'f05481f0',
        feature: { ref: '#621', title: 'Clear everything waiting on you without leaving Dash' },
        module: 'dev',
      },
    ],
    attention: [
      { kind: 'suggestion', title: 'Two questions hold up #338', ref: null, detail: 'Nobody has answered them in a fortnight.' },
      { kind: 'ready', title: 'Build it', ref: '#1', detail: null },
    ],
    night: null,
    createdAt: '2026-09-17T04:05:00Z',
    ...over,
  };
}

describe('DigestPanel', () => {
  it('draws the account of the day and what closed', () => {
    const html = renderToStaticMarkup(<DigestPanel digest={digest()} />);
    expect(html).toContain('What happened');
    expect(html).toContain('A quiet day: one step closed on Dash.');
    expect(html).toContain('Approve a proposal, or all of them, on Dash');
  });

  it('draws no Worth a look card, whatever the night noticed', () => {
    const html = renderToStaticMarkup(<DigestPanel digest={digest()} />);
    expect(html).not.toContain('Worth a look');
    expect(html).not.toContain('Two questions hold up #338');
    expect(html).not.toContain('Nobody has answered them in a fortnight.');
  });

  it('draws nothing before the first summary is written', () => {
    expect(renderToStaticMarkup(<DigestPanel digest={null} />)).toBe('');
  });
});
