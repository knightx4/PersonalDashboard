import { describe, expect, it } from 'vitest';
import { attachTarget, MAX_ATTACHED, savedAttachmentsOf, turnAttached } from './attached';

const ID = '7d2c1e4a-3b5f-4c8e-9a1d-2f6b8c0e4a11';
const card = (id = ID) => ({ table: 'core.files', id, title: 'Prep', kind: 'page', href: `/goals/files/${id}` });

describe('saved pages attached by reference (plan #3050.4)', () => {
  it('reads the target from a table and id or from a full ref', () => {
    expect(attachTarget({ table: 'core.files', ref: ID })).toEqual({ table: 'core.files', id: ID });
    expect(attachTarget({ ref: `core.attachments:${ID.toUpperCase()}` })).toEqual({ table: 'core.attachments', id: ID });
    expect(attachTarget({ table: 'core.files', ref: 'not-an-id' })).toBeNull();
    expect(attachTarget({ table: 'core.notes', ref: ID })).toBeNull();
  });

  it('draws the cards of the calls that succeeded, each thing once', () => {
    const calls = [
      { name: 'attach_saved', input: {}, result: { ok: true, attached: card() } },
      { name: 'attach_saved', input: {}, result: { ok: true, attached: card() } },
      { name: 'attach_saved', input: {}, result: { ok: false, error: 'no' } },
      { name: 'show_chart', input: {}, result: { ok: true, attached: card('1a9e5c3b-6d2f-4e7a-8b0c-5f3d1e9a7c22') } },
    ];
    expect(turnAttached(calls)).toEqual([card()]);
  });

  it('drops a kept card that no longer parses, and keeps at most three', () => {
    expect(savedAttachmentsOf([{ ...card(), href: 'https://elsewhere' }, { ...card(), title: '' }])).toEqual([]);
    const many = ['1', '2', '3', '4'].map((n) => card(`${n}d2c1e4a-3b5f-4c8e-9a1d-2f6b8c0e4a11`));
    expect(savedAttachmentsOf(many)).toHaveLength(MAX_ATTACHED);
  });
});
