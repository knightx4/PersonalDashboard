/**
 * The corner radii (docs/ONE-INTERFACE-SPEC.md, R14). `rounded-pill` was used
 * for chips and badges for weeks while nothing defined it, so the built
 * stylesheet had no rule and every chip was square; these build the
 * stylesheet and look for the rule. The `off-token-radius` counter is checked
 * against a few written-out classes, so a count of zero means the app has
 * none rather than that the counter sees nothing.
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compile } from '@tailwindcss/node';
import { describe, expect, it } from 'vitest';
import { SPEC_COUNTERS } from '@/scripts/spec-counts';

const css = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8');

async function built(classes: string[]): Promise<string> {
  const compiler = await compile(css, { base: join(process.cwd(), 'app'), onDependency: () => {} });
  return compiler.build(classes);
}

function rule(out: string, cls: string): string | null {
  const m = out.match(new RegExp(`\\.${cls}\\s*\\{([^}]*)\\}`));
  return m ? m[1].replace(/\s+/g, ' ').trim() : null;
}

describe('the radius tokens', () => {
  it('build a rule for each token class', async () => {
    const out = await built(['rounded-pane', 'rounded-card', 'rounded-control', 'rounded-pill']);
    for (const token of ['pane', 'card', 'control', 'pill']) {
      expect(rule(out, `rounded-${token}`)).toBe(`border-radius: var(--radius-${token});`);
    }
  });

  it('draw a pill fully round, and square in Poster', async () => {
    const out = await built(['rounded-pill']);
    expect(out).toMatch(/--radius-pill:\s*9999px;/);
    const poster = css.match(/\[data-theme='poster-dark'\]\)\s*\{[^}]*--radius-pill:\s*([^;]+);/);
    expect(poster?.[1]).toBe('0');
  }, 30_000);
});

describe('off-token-radius', () => {
  const counter = SPEC_COUNTERS.find((c) => c.name === 'off-token-radius');

  function measure(files: Record<string, string>): string[] {
    const root = mkdtempSync(join(tmpdir(), 'radius-'));
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(join(root, path, '..'), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    return counter!.measure(root);
  }

  it('counts fixed radius classes and passes the tokens', () => {
    const items = measure({
      'components/x.tsx': [
        "const a = 'size-5 rounded bg-sunken';",
        'const b = <div className="rounded-lg border md:rounded-t-xl" />;',
        'const c = `rounded-[7px] ${x}`;',
        "const d = 'rounded-card rounded-t-control rounded-pill rounded-full rounded-none rounded-pane';",
      ].join('\n'),
    });
    expect(items).toEqual([
      'components/x.tsx:1: rounded',
      'components/x.tsx:2: rounded-lg',
      'components/x.tsx:2: md:rounded-t-xl',
      'components/x.tsx:3: rounded-[7px]',
    ]);
  });

  it('leaves out comments and prose about a class', () => {
    const items = measure({
      'app/y.tsx': [
        '// a rounded-lg corner',
        '/* rounded-md */',
        "const note = 'rounded-lg is a fixed 8px, which the themes skip.';",
        "const label = 'Filter row: rounded-lg, accent tint';",
      ].join('\n'),
    });
    expect(items).toEqual([]);
  });
});
