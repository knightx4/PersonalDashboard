import { describe, expect, it } from 'vitest';
import { decidesSomething, decisionKindRefusal } from './decision-titles';

describe('decisionKindRefusal', () => {
  it('turns away a build or setup step that asks for a choice', () => {
    expect(decisionKindRefusal({ kind: 'setup', title: 'Decide how Ask Dash reaches the studio' })).toMatch(
      /--kind decision/,
    );
    expect(decisionKindRefusal({ kind: 'build', title: 'Choose a chart library' })).not.toBeNull();
    expect(decisionKindRefusal({ kind: 'build', title: 'pick the export format' })).not.toBeNull();
  });

  it('lets a decision through, and a step that only mentions deciding', () => {
    expect(decisionKindRefusal({ kind: 'decision', title: 'Decide how Ask Dash reaches the studio' })).toBeNull();
    expect(decisionKindRefusal({ kind: 'build', title: 'Show the decided options on the page' })).toBeNull();
    expect(decidesSomething('Decision log on Home')).toBe(false);
  });
});
