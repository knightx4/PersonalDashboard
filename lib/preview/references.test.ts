import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  REFERENCE_DIR,
  referenceForCritic, referenceNamed, referenceProblems, type Reference } from './references';

describe('referenceNamed', () => {
  it('reads pictures and links from the Reference line', () => {
    expect(
      referenceNamed('Rows open the story.\n\nReference: docs/references/news-saved/a.png, https://example.com/list'),
    ).toEqual({ pictures: ['docs/references/news-saved/a.png'], links: ['https://example.com/list'] });
  });

  it('takes a bulleted, bold or bracketed line', () => {
    expect(referenceNamed('- **Reference:** <https://example.com/x>.')).toEqual({
      pictures: [],
      links: ['https://example.com/x'],
    });
  });

  it('is null with no such line, or a reference only mentioned mid-sentence', () => {
    expect(referenceNamed('Pattern: list and detail')).toBeNull();
    expect(referenceNamed('A step may carry a `Reference:` line.')).toBeNull();
  });
});

describe('referenceProblems', () => {
  const ok: Reference = { pictures: ['docs/references/a/one.png'], link: null, why: 'Quiet rows.', from: '1.1' };

  it('passes a reference on a gallery surface whose pictures exist', () => {
    expect(referenceProblems({ a: ok }, ['a'], () => true)).toEqual([]);
  });

  it('names a surface the gallery does not have, a missing picture, and an empty reference', () => {
    const problems = referenceProblems(
      { gone: ok, a: ok, b: { ...ok, pictures: [] } },
      ['a', 'b'],
      () => false,
    );
    expect(problems).toContain('gone: not a gallery surface');
    expect(problems).toContain('a: docs/references/a/one.png is not in the repository');
    expect(problems).toContain('b: neither pictures nor a link');
  });
});

describe('the instructions that carry a reference', () => {
  const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8').replace(/\s+/g, ' ');
  const critic = read('.claude/agents/ui-critic.md');
  const building = read('.claude/skills/plan/reference/building.md');
  const shaping = read('.claude/skills/plan/reference/shaping.md');

  it('give the critic the rule from Part 2 and a breaks value for it', () => {
    expect(critic).toContain('"breaks": "reference"');
    expect(critic).toContain('Lawful but worse than the reference fails.');
    expect(critic).toContain('The law wins.');
  });

  it('have the builder register a reference and send it on every round', () => {
    expect(building).toContain('lib/preview/references.ts');
    expect(building).toContain('Send a registered reference to the critic on every round');
    expect(building).toContain(`${REFERENCE_DIR}/<surface>/`);
  });

  it('teach shaping the Reference line', () => {
    expect(shaping).toContain('Reference: https://');
  });
});

describe('referenceForCritic', () => {
  it('asks for a link with no pictures to be photographed first', () => {
    const text = referenceForCritic('a', { pictures: [], link: 'https://example.com', why: 'Calm.', from: '1.1' });
    expect(text).toContain('not yet photographed: shoot it into docs/references/a/');
  });
});
