import { describe, expect, it } from 'vitest';
import {
  PIECE_CELLS_MAX,
  aboveHeldCell,
  checkCell,
  pieceCheckCell,
  pieceCellsPrompt,
  readPieceCells,
  territoryCells,
  type PieceCellView,
  type TerritoryCell,
} from './piece-cells';
import { toCellPieceCheck } from './piece-check';

const cell = (id: string, topicId: string, topicName: string, level: number): TerritoryCell => ({
  id,
  topicId,
  topicName,
  level,
  descriptor: [`check for ${topicName} ${level}`],
});

const view = (cellId: string, level: number, status: PieceCellView['status'] = 'open'): PieceCellView => ({
  cellId,
  topicId: 't',
  topicName: 'Elasticity',
  level,
  status,
});

describe('territoryCells', () => {
  it('keeps each topic up to its target, by topic name then level', () => {
    const cells = [
      cell('e3', 'te', 'Elasticity', 3),
      cell('e1', 'te', 'Elasticity', 1),
      cell('e6', 'te', 'Elasticity', 6),
      cell('a2', 'ta', 'Averages', 2),
      cell('x1', 'tx', 'Not targeted', 1),
    ];
    const out = territoryCells(
      [
        { topicId: 'te', targetLevel: 2 },
        { topicId: 'te', targetLevel: 5 },
        { topicId: 'ta', targetLevel: 2 },
      ],
      cells,
    );
    expect(out.map((c) => c.id)).toEqual(['a2', 'e1', 'e3']);
  });
});

describe('pieceCellsPrompt', () => {
  it('numbers the pieces and keys the cells', () => {
    const text = pieceCellsPrompt({
      trackName: 'Economics',
      unitTitle: 'Elasticity',
      pieces: [{ title: 'Measuring', ideas: [{ name: 'Elasticity', claim: 'How far buyers move.' }] }],
      cells: [cell('e2', 'te', 'Elasticity', 2)],
      tool: 'report_piece_cells',
    });
    expect(text).toContain('1. Measuring');
    expect(text).toContain('   - Elasticity: How far buyers move.');
    expect(text).toContain('C1. Elasticity, level 2: check for Elasticity 2');
    expect(text).toContain('Call report_piece_cells.');
  });
});

describe('readPieceCells', () => {
  const cells = [cell('a', 't', 'T', 1), cell('b', 't', 'T', 2), cell('c', 't', 'T', 3)];

  it('reads keys with or without the C, ignores unknown ones and repeats', () => {
    const out = readPieceCells(
      { pieces: [{ piece: 1, cells: ['C2', '2', 3, 'C9'] }, { piece: 2, cells: [] }] },
      3,
      cells,
    );
    expect(out).toEqual([['b', 'c'], [], []]);
  });

  it('reads a list sent as a string and caps a piece', () => {
    const many = Array.from({ length: 8 }, (_, i) => cell(`k${i}`, 't', 'T', 1));
    const out = readPieceCells({ pieces: [{ piece: '1', cells: 'C1, C2, C3, C4, C5, C6' }] }, 1, many);
    expect(out?.[0]).toHaveLength(PIECE_CELLS_MAX);
  });

  it('ignores a piece number out of range and refuses a malformed reply', () => {
    expect(readPieceCells({ pieces: [{ piece: 4, cells: ['C1'] }] }, 2, cells)).toEqual([[], []]);
    expect(readPieceCells({ nope: true }, 2, cells)).toBeNull();
  });
});

describe('checkCell', () => {
  it('asks the highest level the piece reaches, preferring one not held', () => {
    expect(checkCell([view('a', 2), view('b', 5, 'shown'), view('c', 5)])?.cellId).toBe('c');
    expect(checkCell([view('a', 2), view('b', 5, 'shown')])?.cellId).toBe('b');
  });

  it('leaves out a defence, and is null when nothing can be asked', () => {
    expect(checkCell([view('a', 10), view('b', 3)])?.cellId).toBe('b');
    expect(checkCell([view('a', 10)])).toBeNull();
    expect(checkCell([])).toBeNull();
  });
});

describe('aboveHeldCell and pieceCheckCell (plan #2292.5)', () => {
  const on = (cellId: string, topicId: string, level: number, status: PieceCellView['status'] = 'open'): PieceCellView => ({
    cellId,
    topicId,
    topicName: topicId,
    level,
    status,
  });
  const cells = [on('e3', 'e', 3, 'shown'), on('r2', 'r', 2, 'implied')];
  const ladder = [
    on('e1', 'e', 1, 'shown'),
    on('e3', 'e', 3, 'shown'),
    on('e4', 'e', 4),
    on('e5', 'e', 5),
    on('r1', 'r', 1, 'shown'),
    on('r2', 'r', 2, 'implied'),
    on('r3', 'r', 3, 'shown'),
    on('r4', 'r', 4),
  ];

  it('asks the lowest unheld level above what was shown, on the piece’s topics', () => {
    expect(aboveHeldCell(cells, ladder)?.cellId).toBe('e4');
    expect(aboveHeldCell([on('r2', 'r', 2, 'implied')], ladder)?.cellId).toBe('r4');
  });

  it('skips a defence and is null when nothing above can be asked', () => {
    const top = [on('x9', 'x', 9, 'shown')];
    expect(aboveHeldCell(top, [...top, on('x10', 'x', 10)])).toBeNull();
    expect(aboveHeldCell([on('e4', 'e', 4)], ladder)).toBeNull();
  });

  it('climbs only for a held piece, and falls back to the piece’s own level', () => {
    expect(pieceCheckCell(cells, ladder, true)?.cellId).toBe('e4');
    expect(pieceCheckCell(cells, ladder, false)?.cellId).toBe('e3');
    const top = [on('x9', 'x', 9, 'shown')];
    expect(pieceCheckCell(top, top, true)?.cellId).toBe('x9');
  });
});

describe('toCellPieceCheck', () => {
  const row = {
    id: 'q',
    cell_id: 'c',
    question: 'Explain it.',
    response: 'An answer.',
    answered_at: '2026-10-15T10:00:00Z',
    grade: [
      { cell_id: 'other', verdict: 'met', reason: 'Not this one.' },
      { cell_id: 'c', verdict: 'met', reason: 'It says why.' },
    ],
  };
  const place = { topicId: 't', topicName: 'Elasticity', level: 4 };

  it('is right when the asked cell was shown, with the grader’s reason on it', () => {
    expect(toCellPieceCheck(row, place, true)).toMatchObject({ correct: true, why: 'It says why.', expected: null, cell: place });
  });

  it('is not yet right when nothing met the asked cell, and unmarked before an answer', () => {
    expect(toCellPieceCheck(row, place, false).correct).toBe(false);
    expect(toCellPieceCheck({ ...row, response: null, answered_at: null, grade: null }, place, false)).toMatchObject({
      correct: null,
      why: null,
    });
  });
});
