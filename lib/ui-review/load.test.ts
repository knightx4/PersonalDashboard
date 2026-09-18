import { describe, expect, it } from 'vitest';
import { MODULE_IDS } from '@/lib/modules';
import { byScope, uiReviewFrom, type UiReview } from '@/lib/ui-review/load';

const review = (row: Partial<UiReview> & Pick<UiReview, 'id' | 'scope' | 'createdAt'>): UiReview => ({
  commitSha: null,
  violations: null,
  note: null,
  findings: [],
  ...row,
});

describe('byScope', () => {
  it('has a row for every module, reviewed or not', () => {
    const rows = byScope([review({ id: 'r1', scope: 'vault', createdAt: '2026-09-01T10:00:00Z' })]);

    for (const id of MODULE_IDS) {
      expect(rows.find((row) => row.scope === id)).toBeDefined();
    }
    expect(rows.find((row) => row.scope === 'shared')).toBeDefined();
  });

  it('says never reviewed rather than clean when nobody has looked', () => {
    const rows = byScope([review({ id: 'r1', scope: 'vault', createdAt: '2026-09-01T10:00:00Z' })]);

    expect(rows.find((row) => row.scope === 'learn')?.lastReview).toBeNull();
    expect(rows.find((row) => row.scope === 'learn')?.openFindings).toEqual([]);
    expect(rows.find((row) => row.scope === 'vault')?.lastReview?.id).toBe('r1');
  });

  it('keeps the newest pass for a module, whatever order they arrive in', () => {
    const rows = byScope([
      review({ id: 'old', scope: 'todo', createdAt: '2026-08-14T09:00:00Z' }),
      review({ id: 'new', scope: 'todo', createdAt: '2026-09-09T09:00:00Z' }),
      review({ id: 'middle', scope: 'todo', createdAt: '2026-08-30T09:00:00Z' }),
    ]);

    expect(rows.find((row) => row.scope === 'todo')?.lastReview?.id).toBe('new');
  });

  it('carries only the undecided findings of that pass', () => {
    const pass = uiReviewFrom({
      id: 'r1',
      module: 'shopping',
      commit_sha: 'abc1234',
      violations: 0,
      note: 'Left the sell assistant alone; it is mid-rewrite.',
      created_at: '2026-09-09T09:00:00Z',
      findings: [
        {
          id: 'f1',
          file: 'app/shopping/orders/page.tsx',
          line: 42,
          law: '11',
          surface: 'shopping-item-details',
          body: 'The filter row is a frame around a frame.',
          status: 'dismissed',
          note: 'Deliberate: it is the only thing separating it from the table.',
          created_at: '2026-09-09T09:01:00Z',
          decided_at: '2026-09-09T18:00:00Z',
        },
        {
          id: 'f2',
          file: 'app/shopping/orders/page.tsx',
          line: null,
          law: '2',
          surface: null,
          body: 'An order with no merchant reads as an order from nobody.',
          status: 'open',
          note: null,
          created_at: '2026-09-09T09:02:00Z',
          decided_at: null,
        },
      ],
    });

    const row = byScope([pass]).find((entry) => entry.scope === 'shopping');

    expect(row?.lastReview?.violations).toBe(0);
    expect(row?.lastReview?.findings).toHaveLength(2);
    expect(row?.openFindings.map((finding) => finding.id)).toEqual(['f2']);
    // Undecided first, whatever order the embedded select returned them in.
    expect(row?.lastReview?.findings[0]!.id).toBe('f2');
    expect(row?.lastReview?.findings[1]!.line).toBe(42);
  });
});
