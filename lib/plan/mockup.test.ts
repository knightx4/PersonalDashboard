import { describe, expect, it } from 'vitest';
import type { PlanItem } from '@/lib/plan/load';
import { isReferencePicture, referencePictureHref, withMockups } from '@/lib/plan/mockup';
import type { ScreenChangeView } from '@/lib/plan/screen-change';
import { buildPlanTree } from '@/lib/plan/tree';
import type { Reference } from '@/lib/preview/references';

let counter = 100;

function item(over: Partial<PlanItem> & { id: string; title: string }): PlanItem {
  counter += 1;
  return {
    number: counter,
    module: 'goals',
    parentId: null,
    detail: null,
    acceptance: null,
    status: 'done',
    kind: 'build',
    track: 'feature',
    resolution: null,
    dismissedAt: null,
    comment: null,
    blockAsk: null,
    blockKind: null,
    thread: [],
    priority: 2,
    size: null,
    assignee: null,
    commitSha: null,
    position: counter * 10,
    startedAt: null,
    completedAt: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...over,
  };
}

function change(surface: string): ScreenChangeView {
  return {
    surface,
    round: 1,
    verdict: 'pass',
    checkedAt: '2026-10-15T10:00:00Z',
    before: null,
    after: `/dev/ui/shot?path=${surface}`,
  };
}

const references: Record<string, Reference> = {
  'goals-home': {
    pictures: ['docs/references/goals-home/laptop.png', 'docs/references/goals-home/phone.png'],
    link: 'https://claude.ai/artifact/abc',
    source: 'docs/references/goals-home/page.html',
    why: 'Calm.',
    from: '2000.1',
  },
};

const items = [
  item({ id: 'feature', title: 'Rebuild Goals', acceptance: 'Goals reads well.', status: 'in_progress' }),
  item({
    id: 'look',
    title: 'Which look?',
    parentId: 'feature',
    kind: 'decision',
    resolution: 'B — One list',
  }),
  item({ id: 'one', title: 'Rebuild the goal page', parentId: 'feature' }),
  item({ id: 'two', title: 'Rebuild two screens', parentId: 'feature' }),
  item({ id: 'other', title: 'Elsewhere', module: 'news' }),
];
const sections = buildPlanTree({ items, dependencies: [] });
const number = (id: string) => items.find((i) => i.id === id)!.number;
const pictures = {
  look: [
    { id: 'pa', caption: 'A: Sections', src: '/dev/plan/picture?id=pa' },
    { id: 'pb', caption: 'B: One list', src: '/dev/plan/picture?id=pb' },
  ],
  two: [{ id: 'pc', caption: 'goals-stage drawn', src: '/dev/plan/picture?id=pc' }],
};

describe('withMockups', () => {
  it('pairs a surface with its registered reference, phone picture first', () => {
    const out = withMockups({ [number('other')]: [change('goals-home')] }, sections, {}, references);
    expect(out[number('other')][0].mockup).toEqual({
      src: referencePictureHref('docs/references/goals-home/phone.png'),
      from: 'registered by #2000.1',
      link: 'https://claude.ai/artifact/abc',
    });
  });

  it("takes the chosen drawing from a decision under the step's feature for its only surface", () => {
    const out = withMockups({ [number('one')]: [change('goals-goal')] }, sections, pictures, {});
    expect(out[number('one')][0].mockup?.src).toBe('/dev/plan/picture?id=pb');
    expect(out[number('one')][0].mockup?.from).toMatch(/^B: One list, on #/);
  });

  it('gives a drawing to the surface its caption names when a step changed several', () => {
    const out = withMockups(
      { [number('two')]: [change('goals-goal'), change('goals-stage')] },
      sections,
      { two: pictures.two },
      {},
    );
    expect(out[number('two')][0].mockup).toBeUndefined();
    expect(out[number('two')][1].mockup?.src).toBe('/dev/plan/picture?id=pc');
  });

  it('leaves a step with no mockup as it was', () => {
    const before = { [number('other')]: [change('news-home')] };
    const out = withMockups(before, sections, pictures, references);
    expect(out).toEqual(before);
  });
});

describe('isReferencePicture', () => {
  it('serves only the pictures a reference lists', () => {
    expect(isReferencePicture('docs/references/goals-home/phone.png', references)).toBe(true);
    expect(isReferencePicture('docs/references/goals-home/page.html', references)).toBe(false);
    expect(isReferencePicture('../.env', references)).toBe(false);
  });
});
