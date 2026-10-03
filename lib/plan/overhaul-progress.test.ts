import { describe, expect, it } from 'vitest';
import {
  contractRules,
  countPhrase,
  overhaulProgress,
  specFilesNamedIn,
} from './overhaul-progress';

const SPEC = `# Core

## Rules

**R1.** Every comment thread is stored in \`core.conversations\`.
Checked by: count \`thread-tables\`, baseline 6, target 1.

**R2.** Every write Dash makes has a \`core.dash_actions\` row.
Checked by: test \`tests/dash-actions-recorded.test.ts\`.

**R3.** One model path answers what the person typed.
Checked by: count \`conversational-model-paths\`, baseline 9, target 1.

**R4.** Every link table points through one ref.
Checked by: count \`ref-columns\`, pending #1600.

## Contract

\`\`\`markdown
Rules: R9.
\`\`\`

Rules: R1, R2, R3, R4.

- \`lib/core/refs.ts\`: how one row points at another.
`;

const baseline = { 'thread-tables': 4, 'conversational-model-paths': 1 };

describe('contractRules', () => {
  it('reads the Rules line under the Contract, skipping a fenced example', () => {
    expect(contractRules(SPEC)).toEqual([1, 2, 3, 4]);
  });

  it('is null with no Contract, or a Contract with no Rules line', () => {
    expect(contractRules('# A\n\n## Rules\n\nRules: R1.\n')).toBeNull();
    expect(contractRules('# A\n\n## Contract\n\n- `lib/a.ts`: a.\n')).toBeNull();
  });
});

describe('overhaulProgress', () => {
  it('gives each counted rule its start, target and count now, and names the rest', () => {
    const progress = overhaulProgress('Core', SPEC, baseline);
    expect(progress).toEqual({
      state: 'counting',
      spec: 'Core',
      counts: [
        { rule: 1, counter: 'thread-tables', label: 'thread tables', start: 6, target: 1, now: 4 },
        {
          rule: 3,
          counter: 'conversational-model-paths',
          label: 'conversational model paths',
          start: 9,
          target: 1,
          now: 1,
        },
      ],
      unread: ['R2', 'R4'],
    });
    if (progress.state !== 'counting') throw new Error('unreachable');
    expect(countPhrase(progress.counts[0])).toBe('thread tables 6 to 1: now 4');
  });

  it('names a counted rule whose counter has no recorded value as unread', () => {
    const progress = overhaulProgress('Core', SPEC, {});
    expect(progress).toMatchObject({ state: 'counting', counts: [], unread: ['R1', 'R2', 'R3', 'R4'] });
  });

  it('says when the spec has no Contract, or could not be read', () => {
    expect(overhaulProgress('Core', '# Core\n\n## Rules\n', baseline)).toEqual({
      state: 'no-contract',
      spec: 'Core',
    });
    expect(overhaulProgress('Core', null, baseline)).toEqual({ state: 'missing', spec: 'Core' });
  });
});

describe('specFilesNamedIn', () => {
  const files = ['PLAN-SPEC.md', 'SPEC-LAYER-SPEC.md', 'CORE-AND-DASH-SPEC.md'];

  it('finds whole file names in the order the detail names them', () => {
    expect(
      specFilesNamedIn('Part 4 of docs/SPEC-LAYER-SPEC.md, after CORE-AND-DASH-SPEC.md.', files),
    ).toEqual(['SPEC-LAYER-SPEC.md', 'CORE-AND-DASH-SPEC.md']);
  });

  it('does not find a name inside a longer one, and reads no detail as none', () => {
    expect(specFilesNamedIn('See docs/OLD-PLAN-SPEC.md.', files)).toEqual([]);
    expect(specFilesNamedIn(null, files)).toEqual([]);
  });
});
