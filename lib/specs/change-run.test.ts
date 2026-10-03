import { describe, expect, it } from 'vitest';
import { specChangeRunText } from './change-run';

const change = {
  id: 'c1',
  title: 'Every spec names its counts',
  why: 'Three notes ask for it.',
  spec: 'spec-layer',
  file: 'SPEC-LAYER-SPEC.md',
  diff: '@@ -1 +1,2 @@\n ## Rules\n+Every spec names its counts.\n',
};

describe('specChangeRunText', () => {
  it('points the run at the shaping section, the file and the change', () => {
    const text = specChangeRunText(change);
    expect(text).toContain('"From an approved spec change" in .claude/skills/plan/reference/shaping.md');
    expect(text).toContain('docs/SPEC-LAYER-SPEC.md');
    expect(text).toContain('approved spec change c1');
    expect(text).toContain('```diff\n@@ -1 +1,2 @@\n ## Rules\n+Every spec names its counts.\n```');
    expect(text).toContain('## Why\n\nThree notes ask for it.');
  });

  it('names a spec the change creates by its slug', () => {
    const text = specChangeRunText({ ...change, spec: 'new-one', file: null });
    expect(text).toContain('a new spec, "new-one"');
  });
});
