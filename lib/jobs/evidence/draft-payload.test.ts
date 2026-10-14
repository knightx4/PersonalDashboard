import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BANNED_CONSTRUCTIONS,
  findBannedConstructions,
  parseDraftPayload,
} from './draft-payload';

const offered = ['item-a', 'item-b'];

describe('findBannedConstructions', () => {
  it('matches regardless of case', () => {
    expect(findBannedConstructions('Passionate about ledgers.', ['passionate about'])).toEqual([
      'passionate about',
    ]);
  });

  it('does not fire inside a longer word', () => {
    expect(findBannedConstructions('A dispassionate reading.', ['passionate'])).toEqual([]);
  });

  it('matches punctuation literally, since it has no word boundary', () => {
    expect(findBannedConstructions('I did the work — twice.', ['—'])).toEqual(['—']);
    expect(findBannedConstructions('I did the work, twice.', ['—'])).toEqual([]);
  });

  it('reports each construction once, however often it appears', () => {
    expect(findBannedConstructions('Leverage and leverage again.', ['leverage'])).toEqual([
      'leverage',
    ]);
  });

  it('ignores blank entries in the list', () => {
    expect(findBannedConstructions('Anything at all.', ['', '   '])).toEqual([]);
  });

  it('does not treat a construction as a regex', () => {
    expect(findBannedConstructions('It cost $5 (roughly).', ['$5 (roughly)'])).toEqual([
      '$5 (roughly)',
    ]);
  });

  it('catches the default list on a paragraph written by nobody', () => {
    const found = findBannedConstructions(
      'I am excited about the opportunity to leverage synergy — passionate about this.',
      DEFAULT_BANNED_CONSTRUCTIONS,
    );
    expect(found).toContain('passionate about');
    expect(found).toContain('leverage');
    expect(found).toContain('—');
  });
});

describe('parseDraftPayload', () => {
  it('keeps a draft that cites what it was given', () => {
    const result = parseDraftPayload(
      {
        answer: 'I rebuilt the close process.',
        evidence_item_ids: ['item-a'],
        unsupported_claims: [],
      },
      offered,
      [],
    );
    expect(result).toEqual({
      ok: true,
      draft: {
        text: 'I rebuilt the close process.',
        evidenceItemIds: ['item-a'],
        unsupportedClaims: [],
        bannedFound: [],
      },
    });
  });

  it('drops a cited id that was never offered, and says so', () => {
    const result = parseDraftPayload(
      {
        answer: 'I rebuilt the close process.',
        evidence_item_ids: ['item-a', 'invented'],
      },
      offered,
      [],
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.evidenceItemIds).toEqual(['item-a']);
    expect(result.draft.unsupportedClaims).toContain(
      'Part of this cited an evidence item that does not exist.',
    );
  });

  it('keeps a draft that cites nothing, since it may answer from the posting', () => {
    const result = parseDraftPayload(
      { answer: 'Sent is building one API for every channel.', evidence_item_ids: [] },
      offered,
      [],
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.evidenceItemIds).toEqual([]);
  });

  it('keeps a draft whose every citation was invented, and flags it', () => {
    const result = parseDraftPayload(
      { answer: 'I did a thing.', evidence_item_ids: ['nope'] },
      offered,
      [],
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.evidenceItemIds).toEqual([]);
    expect(result.draft.unsupportedClaims.join(' ')).toMatch(/does not exist/);
  });

  it('carries the unsupported claims through rather than smoothing them over', () => {
    const result = parseDraftPayload(
      {
        answer: 'I rebuilt the close and led a team of nine.',
        evidence_item_ids: ['item-a'],
        unsupported_claims: ['led a team of nine'],
      },
      offered,
      [],
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.unsupportedClaims).toEqual(['led a team of nine']);
  });

  it('flags the banned constructions it was told about', () => {
    const result = parseDraftPayload(
      { answer: 'I am passionate about close processes.', evidence_item_ids: ['item-b'] },
      offered,
      ['passionate about'],
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.bannedFound).toEqual(['passionate about']);
  });

  it('dedupes a repeated citation', () => {
    const result = parseDraftPayload(
      { answer: 'Twice cited.', evidence_item_ids: ['item-a', 'item-a'] },
      offered,
      [],
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.evidenceItemIds).toEqual(['item-a']);
  });

  it('rejects a malformed payload', () => {
    expect(parseDraftPayload({ answer: '' }, offered, []).ok).toBe(false);
    expect(parseDraftPayload({ evidence_item_ids: ['item-a'] }, offered, []).ok).toBe(false);
  });
});
