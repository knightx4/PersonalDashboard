import { describe, expect, it } from 'vitest';
import type { PipelineRow } from '@/lib/jobs/applications/load';
import { formatCompBand } from '@/lib/jobs/applications/load';
import type { ApplicationStatus } from '@/lib/jobs/pipeline';
import {
  filterPipeline,
  pageOf,
  parsePipeline,
  pipelineDescription,
  pipelineHref,
  rolesRedirect,
} from './pipeline-view';

function row(status: ApplicationStatus, extra: Partial<PipelineRow> = {}): PipelineRow {
  return {
    status,
    source: 'cold_apply',
    excitement: null,
    scoreNote: null,
    companyName: 'Monzo',
    roleTitle: 'Backend Engineer',
    ...extra,
  } as PipelineRow;
}

describe('parsePipeline', () => {
  it('opens on focus and the live applications', () => {
    const state = parsePipeline({});
    expect(state.view).toBe('focus');
    expect(parsePipeline({ view: 'board' }).view).toBe('board');
    expect(state.scope).toBe('live');
    expect(state.page).toBe(1);
  });

  it('takes the closed ones to the table, which is where they are kept', () => {
    expect(parsePipeline({ status: 'closed' }).view).toBe('table');
    expect(parsePipeline({ status: 'all', view: 'board' }).view).toBe('table');
  });

  it('reads an unknown status as live and a bad page as the first', () => {
    expect(parsePipeline({ status: 'submitted' }).scope).toBe('live');
    expect(parsePipeline({ page: '-3' }).page).toBe(1);
    expect(parsePipeline({ excitement: '2' }).excitement).toBeNull();
  });
});

describe('filterPipeline', () => {
  const rows = [
    row('lead'),
    row('submitted', { excitement: 5 }),
    row('rejected'),
    row('ghosted', { source: 'referral' }),
  ];

  it('counts a lead as live and anything closed as not', () => {
    expect(filterPipeline(rows, parsePipeline({})).scoped.map((r) => r.status)).toEqual(['lead', 'submitted']);
    expect(filterPipeline(rows, parsePipeline({ status: 'closed' })).scoped).toHaveLength(2);
    expect(filterPipeline(rows, parsePipeline({ status: 'all' })).scoped).toHaveLength(4);
  });

  it('narrows within the scope', () => {
    const { scoped, filtered } = filterPipeline(rows, parsePipeline({ excitement: '4' }));
    expect(scoped).toHaveLength(2);
    expect(filtered.map((r) => r.status)).toEqual(['submitted']);
    expect(filterPipeline(rows, parsePipeline({ status: 'closed', source: 'referral' })).filtered).toHaveLength(1);
  });
});

describe('pageOf', () => {
  it('pages and clamps', () => {
    const items = Array.from({ length: 120 }, (_, i) => i);
    expect(pageOf(items, 2)).toMatchObject({ page: 2, pages: 3, first: 51, last: 100 });
    expect(pageOf(items, 9)).toMatchObject({ page: 3, first: 101, last: 120 });
    expect(pageOf([], 1)).toMatchObject({ page: 1, pages: 1, first: 0, last: 0 });
  });
});

describe('pipelineHref', () => {
  it('keeps the other filters, drops the page and leaves defaults out', () => {
    expect(pipelineHref({ view: 'table', source: 'referral', page: '3' }, { status: 'closed' })).toBe(
      '/jobs/pipeline?view=table&source=referral&status=closed',
    );
    expect(pipelineHref({ view: 'table', status: 'closed' }, { view: 'focus', status: undefined })).toBe(
      '/jobs/pipeline',
    );
    expect(pipelineHref({ view: 'table' }, { view: 'board' })).toBe('/jobs/pipeline?view=board');
    expect(pipelineHref({ view: 'table' }, { page: '2' })).toBe('/jobs/pipeline?view=table&page=2');
  });

  it('lands an old Roles link on the table with what it asked for', () => {
    expect(rolesRedirect({})).toBe('/jobs/pipeline?view=table');
    expect(rolesRedirect({ sort: 'company', hide: ['comp', 'fit'] })).toBe(
      '/jobs/pipeline?sort=company&hide=comp%2Cfit&view=table',
    );
  });
});

describe('the filters a number on Today sets', () => {
  const NOW = new Date('2026-10-07T12:00:00.000Z');
  const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();

  it('narrows to one stage, folded as the board folds it', () => {
    const rows = [row('lead'), row('acknowledged'), row('submitted'), row('in_process'), row('rejected')];
    const { filtered } = filterPipeline(rows, parsePipeline({ stage: 'submitted' }), NOW);
    expect(filtered.map((r) => r.status)).toEqual(['acknowledged', 'submitted']);
    expect(parsePipeline({ stage: 'nonsense' }).stage).toBeNull();
  });

  it('narrows to what was sent in the window, the confirmation standing in for the send', () => {
    const rows = [
      row('acknowledged', { submittedAt: daysAgo(2), confirmationReceivedAt: null }),
      row('rejected', { submittedAt: null, confirmationReceivedAt: daysAgo(5) }),
      row('acknowledged', { submittedAt: daysAgo(9), confirmationReceivedAt: null }),
    ];
    const { filtered } = filterPipeline(rows, parsePipeline({ status: 'all', sent: '7' }), NOW);
    expect(filtered).toHaveLength(2);
    expect(parsePipeline({ sent: '0' }).sentDays).toBeNull();
    expect(parsePipeline({ sent: '400' }).sentDays).toBeNull();
  });
});

describe('pipelineDescription', () => {
  it('says how many, of which kind', () => {
    expect(pipelineDescription(parsePipeline({}), 36, 36, undefined)).toBe('36 live applications.');
    expect(pipelineDescription(parsePipeline({ status: 'closed' }), 3, 328, undefined)).toBe(
      '3 of 328 closed applications shown.',
    );
    expect(pipelineDescription(parsePipeline({ q: 'monzo' }), 1, 36, 'monzo')).toBe(
      '1 of 36 live applications match “monzo”.',
    );
  });
});

describe('formatCompBand', () => {
  it('draws one figure when both ends match', () => {
    expect(formatCompBand(21_000_000, 21_000_000)).toBe('$210k');
    expect(formatCompBand(18_000_000, 24_000_000)).toBe('$180k–$240k');
  });
});
