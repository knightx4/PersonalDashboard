import { describe, expect, it } from 'vitest';
import { cleanPanelMembers, cleanPanelName, panelOf, panelPicked, panelSeats, type BoardPanel } from './board-panels';

const money: BoardPanel = { id: 'p1', name: 'Money', advisors: ['cfo', 'buffett', 'dalio', 'dimon'], topic: null };

describe('panels', () => {
  it('reads a row and drops one with no name', () => {
    expect(panelOf({ id: 'p1', name: ' Money ', advisors: ['cfo', 3] })).toEqual({ id: 'p1', name: 'Money', advisors: ['cfo'], topic: null });
    expect(panelOf({ id: 'p1', name: ' ' })).toBeNull();
  });

  it('cleans a name', () => {
    expect(cleanPanelName('  Big   bets ')).toEqual({ ok: true, name: 'Big bets' });
    expect(cleanPanelName(' ').ok).toBe(false);
    expect(cleanPanelName('x'.repeat(61)).ok).toBe(false);
  });

  it('cleans members: once each, all on the board, at most twelve', () => {
    const many = Array.from({ length: 12 }, (_, i) => `g${i}`);
    const roster = ['cfo', 'buffett', ...many];
    expect(cleanPanelMembers(['cfo', 'cfo', 'buffett'], roster)).toEqual({ ok: true, advisors: ['cfo', 'buffett'] });
    expect(cleanPanelMembers(['nobody'], roster).ok).toBe(false);
    expect(cleanPanelMembers([...many, 'cfo'], roster).ok).toBe(false);
  });

  it('seats only the members the form offers, and knows when that is what is picked', () => {
    const offered = ['cfo', 'buffett', 'dimon'];
    expect(panelSeats(money, offered)).toEqual(['cfo', 'buffett', 'dimon']);
    expect(panelPicked(money, ['dimon', 'cfo', 'buffett'], offered)).toBe(true);
    expect(panelPicked(money, ['cfo'], offered)).toBe(false);
    expect(panelPicked({ ...money, advisors: ['dalio'] }, [], offered)).toBe(false);
  });
});
