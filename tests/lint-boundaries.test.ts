/**
 * The lint boundaries have to actually fire.
 *
 * They were silently dead for a while during the job tracker's build: two
 * config entries set `no-restricted-imports` for overlapping globs, ESLint kept
 * only the last one, and the service-role rule stopped applying without any
 * error anywhere. Merging the two apps' configs re-ran exactly that risk --
 * this app's money rule and the job side's funnel rule are both
 * `no-restricted-syntax` over the same files -- so both selectors now live in
 * one config entry, and the last two cases below are what proves it.
 */
import { rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const created: string[] = [];

function lint(relativePath: string, source: string): string {
  const target = join(ROOT, relativePath);
  writeFileSync(target, source);
  created.push(target);
  try {
    execFileSync('npx', ['eslint', '--no-warn-ignored', relativePath], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: 'pipe',
    });
    return '';
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string };
    return `${err.stdout ?? ''}${err.stderr ?? ''}`;
  } finally {
    rmSync(target, { force: true });
  }
}

afterAll(() => {
  for (const path of created) rmSync(path, { force: true });
});

const SERVICE_ROLE_IMPORT = `import { createServiceSupabase } from '@/inngest/supabase-admin';
export function thing() {
  return createServiceSupabase();
}
`;

const ATS_IMPORT = `import { fetchPosting } from '@/lib/jobs/ats/greenhouse';
export const handler = fetchPosting;
`;

const MONEY_SYNTAX = `export const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
`;

const RATE_SYNTAX = `export function rate(rows: unknown[], hits: number) {
  return hits / rows.length;
}
`;

describe('the service-role boundary', () => {
  it('blocks the admin client from a component', () => {
    expect(lint('components/__boundary_probe.ts', SERVICE_ROLE_IMPORT)).toMatch(
      /no-restricted-imports/,
    );
  });

  it('blocks it from a page as well', () => {
    expect(lint('app/__boundary_probe.ts', SERVICE_ROLE_IMPORT)).toMatch(
      /no-restricted-imports/,
    );
  });

  it('still allows it in the cron routes, which have no session to use', () => {
    expect(lint('app/api/cron/__boundary_probe.ts', SERVICE_ROLE_IMPORT)).toBe('');
  });
});

describe('the ATS boundary', () => {
  it('blocks a vendor module from a page', () => {
    expect(lint('app/__boundary_probe.ts', ATS_IMPORT)).toMatch(/no-restricted-imports/);
  });

  it('still applies inside the exempted cron routes', () => {
    expect(lint('app/api/cron/__boundary_probe.ts', ATS_IMPORT)).toMatch(
      /no-restricted-imports/,
    );
  });
});

/**
 * One entry, two selectors. If someone splits these back into two config
 * objects, whichever is listed first stops firing and one of these fails.
 */
describe('the derived-number boundaries', () => {
  it('blocks inline currency formatting', () => {
    expect(lint('components/__boundary_probe.ts', MONEY_SYNTAX)).toMatch(
      /no-restricted-syntax/,
    );
  });

  it('blocks an inline rate, in the same files', () => {
    expect(lint('components/__boundary_probe.ts', RATE_SYNTAX)).toMatch(
      /no-restricted-syntax/,
    );
  });
});
