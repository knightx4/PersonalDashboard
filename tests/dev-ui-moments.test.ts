/**
 * Two rules of docs/UI-QUALITY-SPEC.md, Part 8.
 *
 * R6: every animation has a reduced-motion version. Every rule in
 * app/globals.css that plays keyframes is named again inside a
 * prefers-reduced-motion block that stops it, every moment in the catalogue
 * says what is left of it, and every file that animates from code checks
 * reduced motion first.
 *
 * R8: no workspace has more than three moments. A fourth is a decision for
 * the person, so this fails until the catalogue is back at three.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  MOMENT_WORKSPACES,
  MOMENTS,
  MOMENTS_PER_WORKSPACE,
  overfullWorkspaces,
  type Moment,
} from '../app/dev/ui/moments';

const root = process.cwd();
const css = readFileSync(join(root, 'app/globals.css'), 'utf8');

type Use = { selector: string; keyframes: string; reduced: boolean; none: boolean };

/**
 * Every `animation` declaration in the stylesheet, with the selector it sits
 * under (nesting and `@utility` resolved) and whether it is inside a
 * prefers-reduced-motion block. Enough of a CSS reader for this file: blocks
 * are braces, and a declaration ends at a semicolon.
 */
function animationUses(source: string): Use[] {
  const text = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const stack: string[] = [];
  const uses: Use[] = [];
  let buffer = '';
  const selectorOf = (): string => {
    let selector = '';
    for (const prelude of stack) {
      if (prelude.startsWith('@utility ')) selector = `.${prelude.slice(9).trim()}`;
      else if (prelude.startsWith('@')) continue;
      else if (prelude.includes('&')) selector = prelude.replaceAll('&', selector);
      else selector = selector ? `${selector} ${prelude}` : prelude;
    }
    return selector;
  };
  for (const char of text) {
    if (char === '{') {
      stack.push(buffer.trim().replace(/\s+/g, ' '));
      buffer = '';
    } else if (char === '}') {
      stack.pop();
      buffer = '';
    } else if (char === ';') {
      const declaration = /^animation(?:-name)?\s*:\s*([\w-]+)/.exec(buffer.trim());
      if (declaration) {
        uses.push({
          selector: selectorOf(),
          keyframes: declaration[1],
          reduced: stack.some((prelude) => /prefers-reduced-motion:\s*reduce/.test(prelude)),
          none: declaration[1] === 'none',
        });
      }
      buffer = '';
    } else {
      buffer += char;
    }
  }
  return uses;
}

/** `a, b` to its parts, so a selector list is compared one selector at a time. */
const parts = (selector: string) =>
  selector.split(',').map((part) => part.trim().replace(/\s+/g, ' '));

describe('R6: every animation has a reduced-motion version', () => {
  const uses = animationUses(css);
  const stopped = new Set(
    uses.filter((use) => use.reduced && use.none).flatMap((use) => parts(use.selector)),
  );
  const playing = uses.filter((use) => !use.reduced && !use.none);

  it('reads the animations out of globals.css', () => {
    // A reader that finds nothing would pass everything below.
    expect(playing.length).toBeGreaterThan(20);
    expect(stopped.size).toBeGreaterThan(20);
  });

  it('the catch-all still shortens every animation and transition', () => {
    const block =
      /@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\*,\s*\*::before,\s*\*::after\s*\{([^}]*)\}/.exec(
        css,
      );
    expect(block?.[1]).toMatch(/animation-duration:\s*0\.01ms !important/);
    expect(block?.[1]).toMatch(/transition-duration:\s*0\.01ms !important/);
  });

  it.each(
    playing.flatMap((use) => parts(use.selector).map((selector) => [use.keyframes, selector])),
  )('%s on %s is stopped under reduced motion', (_keyframes, selector) => {
    expect(stopped.has(selector)).toBe(true);
  });

  it('every file that animates from code checks reduced motion', () => {
    const files = execFileSync(
      'git',
      ['grep', '-l', '-E', '\\.animate\\(', '--', 'app', 'components', 'lib'],
      {
        cwd: root,
        encoding: 'utf8',
      },
    )
      .split('\n')
      .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const source = readFileSync(join(root, file), 'utf8');
      expect(source, file).toMatch(/useReducedMotion|prefersReducedMotion/);
    }
  });

  it.each(MOMENTS.map((moment) => [moment.name, moment] as const))(
    'the moment "%s" says what is left under reduced motion',
    (_name, moment) => {
      expect(moment.reducedMotion.trim().length).toBeGreaterThan(10);
    },
  );
});

describe('R8: no workspace has more than three moments', () => {
  it('the catalogue holds at most three per workspace', () => {
    expect(MOMENTS_PER_WORKSPACE).toBe(3);
    expect(overfullWorkspaces(MOMENTS)).toEqual([]);
  });

  it('a fourth moment in one workspace is caught', () => {
    const jobs = MOMENTS.filter((moment) => moment.workspace === 'jobs');
    expect(jobs).toHaveLength(3);
    const fourth: Moment = { ...jobs[0], name: 'A fourth' };
    expect(overfullWorkspaces([...MOMENTS, fourth])).toEqual([{ workspace: 'jobs', count: 4 }]);
  });

  it('every moment is in a workspace the page lists, under a unique name', () => {
    const listed = new Set(MOMENT_WORKSPACES.map(([workspace]) => workspace));
    for (const moment of MOMENTS) expect(listed.has(moment.workspace), moment.name).toBe(true);
    expect(new Set(MOMENTS.map((moment) => moment.name)).size).toBe(MOMENTS.length);
  });

  it('a moment not fully built names the step that builds it, and a demo it names is on the page', () => {
    const page = readFileSync(join(root, 'app/dev/ui/page.tsx'), 'utf8');
    for (const moment of MOMENTS) {
      if (moment.state.built !== 'yes') expect(moment.state.step, moment.name).toBeGreaterThan(0);
      if (moment.demo) expect(page, moment.name).toContain(`id="${moment.demo}"`);
    }
  });
});
