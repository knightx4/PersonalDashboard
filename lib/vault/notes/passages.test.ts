import { describe, expect, it } from 'vitest';
import { EMBEDDING_DIMENSIONS } from '@/lib/learn/embed/voyage';
import { findPassages, type PassagePorts } from '@/lib/vault/notes/passages';

const vector = new Array(EMBEDDING_DIMENSIONS).fill(0.01);

function ports(rows: Awaited<ReturnType<PassagePorts['nearestBlocks']>>) {
  const asked: unknown[] = [];
  const p: PassagePorts = {
    async cached() {
      return null;
    },
    async keep() {},
    async embed() {
      return { vector, model: 'voyage-4-lite' };
    },
    async nearestBlocks(_vector, options) {
      asked.push(options);
      return rows;
    },
  };
  return { p, asked };
}

describe('findPassages', () => {
  it('returns passages above the floor with their place and link', async () => {
    const { p, asked } = ports([
      { block_id: 'b1', note_id: 'n1', path: 'Ideas/On pricing.md', title: 'On pricing', heading_path: ['Reasons'], passage: '# Reasons\nPeople pay for time.', similarity: 0.7 },
      { block_id: 'b2', note_id: 'n2', path: 'Other.md', title: null, heading_path: null, passage: 'Weak match.', similarity: 0.3 },
    ]);
    const found = await findPassages(p, 'Why people pay', { exclude: ['n9'] });
    expect(found).toEqual([
      {
        blockId: 'b1',
        noteId: 'n1',
        path: 'Ideas/On pricing.md',
        title: 'On pricing',
        headingPath: ['Reasons'],
        text: '# Reasons\nPeople pay for time.',
        similarity: 0.7,
        href: '/vault/n/Ideas/On%20pricing.md',
      },
    ]);
    expect(asked[0]).toEqual({ limit: 3, minSimilarity: 0.55, exclude: ['n9'] });
  });

  it('asks nothing for empty text', async () => {
    const { p, asked } = ports([]);
    expect(await findPassages(p, '   ')).toEqual([]);
    expect(asked).toHaveLength(0);
  });
});
