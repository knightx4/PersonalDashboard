import { EssaysView } from '@/app/learn/essays/essays-view';
import { EssayView } from '@/app/learn/e/[id]/essay-view';
import type { Essay, EssaySummary } from '@/lib/learn/essays/model';

/**
 * The Essays list and the essay editor (plan #1865), from fixtures shaped like
 * `learn.essays` rows. The economics thread the other Learn surfaces use runs
 * through the essays too.
 */

const NOW = new Date('2026-10-12T15:00:00Z');

const essays: EssaySummary[] = [
  {
    id: '00000000-0000-4000-8000-000000000001',
    title: 'Why money is the odd good out',
    question: 'Why does money not wear out the way every other good does?',
    words: 812,
    wordTarget: 1200,
    publishedAt: null,
    updatedAt: '2026-10-12T14:20:00Z',
  },
  {
    id: '00000000-0000-4000-8000-000000000002',
    title: 'Elasticity explains why petrol taxes raise money and restaurant taxes raise complaints, and why the difference matters for anyone setting a price',
    question: '',
    words: 1640,
    wordTarget: null,
    publishedAt: '2026-10-04T09:00:00Z',
    updatedAt: '2026-10-04T09:00:00Z',
  },
  {
    id: '00000000-0000-4000-8000-000000000003',
    title: 'Untitled essay',
    question: '',
    words: 0,
    wordTarget: null,
    publishedAt: null,
    updatedAt: '2025-12-30T18:00:00Z',
  },
];

export function LearnEssaysSurface() {
  return <EssaysView essays={essays} now={NOW} />;
}

export function LearnEssaysEmptySurface() {
  return <EssaysView essays={[]} now={NOW} />;
}

const draft = `# Why money is the odd good out

Every good you buy wears out, gets eaten or goes out of fashion. A loaf is worth less on Thursday than on Monday. A coat is worth less after a winter. Money is the one good we expect to hold its value while it sits in a drawer, and that expectation is *strange* once you look at it.

## What a good is for

Walzer says each good has a **sphere**: the reasons it is handed out belong to what it is. Bread goes to the hungry, offices to the qualified. Money is the good whose sphere is every other sphere, which is why it keeps leaking across the borders he draws.

> Money is the universal pander.

If that is right, money is less a good than a solvent. It holds its value only because it can turn into everything else, and the moment it cannot, as in a hyperinflation, nobody wants to hold it at all.

## The objection

The obvious reply is that gold held its value for centuries without being a solvent for anything. `;

const essay: Essay = {
  id: '00000000-0000-4000-8000-000000000001',
  path: 'Essays/Why money is the odd good out.md',
  draftBody: draft,
  unsaved: true,
  brief: {
    question: 'Why does money not wear out the way every other good does?',
    claim: 'Money holds its value only because it can become every other good.',
    reader: 'A friend who knows nothing about economics',
  },
  wordTarget: 1200,
  publishedAt: null,
  updatedAt: '2026-10-12T14:20:00Z',
};

export function LearnEssaySurface() {
  return <EssayView essay={essay} />;
}
