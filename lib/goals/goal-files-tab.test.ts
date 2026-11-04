import { describe, expect, it } from 'vitest';
import {
  emptyViewLine,
  fileTypeLabel,
  filesInView,
  matchWords,
  uploadPlace,
  uploadTitle,
  viewCounts,
  waitingRows,
  workCount,
  workEntries,
  type WaitingKind,
  type WorkRun,
} from './goal-files-tab';

const LETTER: WaitingKind = {
  kindId: 'k-letter',
  name: 'IBR approval letter',
  recognise: 'A letter from Edfinancial approving income-based repayment, giving the new monthly payment.',
  stepId: 'save-letter',
  stepTitle: 'Save Edfinancial’s IBR approval showing the $0 payment',
};
const STATEMENT: WaitingKind = {
  kindId: 'k-statement',
  name: 'Edfinancial statement',
  recognise: 'A monthly statement from Edfinancial naming each loan by its loan ID.',
  stepId: 'log',
  stepTitle: 'Log each loan balance',
};

describe('waitingRows', () => {
  it('keeps a kind until a file of it is linked, once each', () => {
    expect(waitingRows([LETTER, STATEMENT, LETTER], new Set()).map((r) => r.kindId)).toEqual([
      'k-letter',
      'k-statement',
    ]);
    expect(waitingRows([LETTER, STATEMENT], new Set(['k-letter'])).map((r) => r.kindId)).toEqual(['k-statement']);
  });
});

describe('uploadPlace', () => {
  const steps = [
    { id: 'autopay', title: 'Turn on autopay for all four loans' },
    { id: 'recert', title: 'Recertify income for IBR before the yearly deadline' },
  ];

  it('puts a letter on the step whose kind its name matches, and fills the kind', () => {
    expect(uploadPlace('IBR_approval_Nov.pdf', [STATEMENT, LETTER], steps)).toEqual({
      stepId: 'save-letter',
      kindId: 'k-letter',
    });
  });

  it('takes the kind with the most words in common', () => {
    expect(uploadPlace('edfinancial-statement-oct.pdf', [LETTER, STATEMENT], steps)).toEqual({
      stepId: 'log',
      kindId: 'k-statement',
    });
  });

  it('falls back to an open step sharing two words, then the goal', () => {
    expect(uploadPlace('autopay confirmation loans.pdf', [], steps)).toEqual({ stepId: 'autopay', kindId: null });
    expect(uploadPlace('scan0001.pdf', [LETTER], steps)).toEqual({ stepId: null, kindId: null });
  });

  it('takes the kind Add was pressed on, whatever the name', () => {
    expect(uploadPlace('scan0001.pdf', [LETTER, STATEMENT], steps, 'k-statement')).toEqual({
      stepId: 'log',
      kindId: 'k-statement',
    });
  });
});

describe('matchWords and uploadTitle', () => {
  it('drops the extension, filler and numbers', () => {
    expect([...matchWords('Scan_of_the_IBR-approval 2026.pdf')]).toEqual(['ibr', 'approval']);
  });

  it('names an upload by its file name', () => {
    expect(uploadTitle('IBR_approval_letter.pdf')).toBe('IBR approval letter');
    expect(uploadTitle('.pdf')).toBe('.pdf');
  });
});

describe('the views', () => {
  const rows = [
    { fileId: 'a', byDash: true, updatedAt: '2026-11-02T00:00:00Z' },
    { fileId: 'b', byDash: false, updatedAt: '2026-11-03T00:00:00Z' },
    { fileId: 'c', byDash: true, updatedAt: '2026-09-01T00:00:00Z', pinned: true },
  ];

  it('lists the pinned first, then the newest', () => {
    expect(filesInView(rows, 'all').map((r) => r.fileId)).toEqual(['c', 'b', 'a']);
    expect(filesInView(rows, 'dash').map((r) => r.fileId)).toEqual(['c', 'a']);
    expect(filesInView(rows, 'yours').map((r) => r.fileId)).toEqual(['b']);
  });

  it('counts each view', () => {
    expect(viewCounts(rows, 2)).toEqual({ all: 3, dash: 2, yours: 1, waiting: 2 });
  });

  it('says something in every empty view', () => {
    for (const view of ['all', 'dash', 'yours', 'waiting'] as const) expect(emptyViewLine(view)).not.toBe('');
  });

  it('names what a file is', () => {
    expect(fileTypeLabel(null)).toBe('Note');
    expect(fileTypeLabel('application/pdf')).toBe('PDF');
    expect(fileTypeLabel('image/png')).toBe('Img');
  });
});

describe('workEntries', () => {
  const now = Date.parse('2026-11-04T12:00:00Z');
  const base = { summary: null, error: null, endedAt: null, lastSeenAt: null, nowOn: null };
  const runs: WorkRun[] = [
    {
      ...base,
      id: 'r-step',
      job: 'step',
      itemId: 'walk',
      status: 'done',
      createdAt: '2026-11-02T10:00:00Z',
      endedAt: '2026-11-02T10:20:00Z',
      summary: 'Ten steps for the federal site.\nMore below.',
      question: null,
      origin: null,
    },
    {
      ...base,
      id: 'r-chat',
      job: 'goal',
      itemId: 'goal',
      status: 'failed',
      createdAt: '2026-11-03T10:00:00Z',
      endedAt: '2026-11-03T10:05:00Z',
      error: 'No statement in Gmail yet.',
      question: 'Can the servicer hold the bills?',
      origin: 'chat',
    },
    {
      ...base,
      id: 'r-map',
      job: 'goal',
      itemId: 'goal',
      status: 'done',
      createdAt: '2026-09-25T10:00:00Z',
      endedAt: '2026-09-25T11:00:00Z',
      question: null,
      origin: null,
    },
  ];
  const files = [
    { fileId: 'f-walk', title: 'Walkthrough', byDash: true, updatedAt: '2026-11-02T10:15:00Z', stepId: 'walk' },
    { fileId: 'f-old', title: 'Older', byDash: true, updatedAt: '2026-10-01T00:00:00Z', stepId: 'walk' },
  ];

  it('lists every run newest first, with the question, where it started, the result and the file', () => {
    const entries = workEntries(runs, 'goal', new Map([['walk', 'Apply for IBR']]), files, now);
    expect(entries.map((e) => [e.title, e.state, e.startedFrom, e.result, e.file?.fileId ?? null])).toEqual([
      ['Can the servicer hold the bills?', 'failed', 'From a chat', 'No statement in Gmail yet.', null],
      ['Apply for IBR', 'done', 'On the step “Apply for IBR”', 'Ten steps for the federal site.', 'f-walk'],
      ['Mapped the goal', 'done', 'On the goal', null, null],
    ]);
    expect(workCount(entries)).toBe('3 pieces');
    expect(workCount([{ state: 'running' }])).toBe('1 piece · 1 going');
    expect(workCount([])).toBeNull();
  });
});
