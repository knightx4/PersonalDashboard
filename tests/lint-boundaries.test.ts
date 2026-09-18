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
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const created: string[] = [];

function lint(relativePath: string, source: string): string {
  const target = join(ROOT, relativePath);
  // A probe may name a directory that does not exist yet -- app/api/s/ is
  // covered by the share-read boundary but holds no route today, because the
  // form writes through a server action. The rule should still be asserted, so
  // the probe makes its own directory rather than the test quietly depending
  // on one some other feature happened to leave behind.
  mkdirSync(dirname(target), { recursive: true });
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

const VAULT_PROVIDER_IMPORT = `import { GithubVaultSource } from '@/lib/vault/providers/github';
export const source = GithubVaultSource;
`;

const LEARN_FETCH_IMPORT = `import { fetchDocument } from '@/lib/learn/providers/fetch';
export const fetcher = fetchDocument;
`;

const ICAL_IMPORT = `import ICAL from 'ical.js';
export const parse = ICAL.parse;
`;

const SELL_IMPORT = `import { runPriceLookups } from '@/lib/sell/price-run';
export const load = runPriceLookups;
`;

const BGG_IMPORT = `import { searchGames } from '@/lib/games/providers/bgg';
export const search = searchGames;
`;

const FX_IMPORT = `import { getFxRate } from '@/lib/fx/rates';
export const rate = getFxRate;
`;

const ANTHROPIC_IMPORT = `import Anthropic from '@anthropic-ai/sdk';
export const client = Anthropic;
`;

const BARE_FETCH = `export async function price(url: string) {
  const res = await fetch(url);
  return res.json();
}
`;

const MONEY_SYNTAX = `export const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
`;

const RATE_SYNTAX = `export function rate(rows: unknown[], hits: number) {
  return hits / rows.length;
}
`;

const OFF_SCALE_TYPE = `export const heading = 'font-display text-2xl font-semibold';
`;

const ON_SCALE_TYPE = `export const heading = 'font-display text-title font-semibold sm:text-figure-lg text-body text-small';
`;

const ARBITRARY_WIDTH = `export const page = 'mx-auto max-w-[1100px] px-6';
`;

const NAMED_WIDTH = `export const page = 'mx-auto max-w-3xl px-6 max-w-[1400px] max-w-sm';
`;

const RAW_HEX =
  "export const badge = `tabular bg-caution-fill text-[#14100a] ${'x'}`;\n";

const RAW_PALETTE = `export const chip = 'rounded bg-emerald-50 text-emerald-700';
`;

/**
 * The design language's hard rules, held by the linter rather than by review.
 *
 * Each probe is a string that was actually in the tree before the rule
 * existed. The passing cases matter as much as the failing ones: a rule that
 * also bites `text-body` or `max-w-[1400px]` is a rule people disable.
 */
describe('the design-language rules', () => {
  it('blocks an off-scale type size', () => {
    expect(lint('components/__design_probe.ts', OFF_SCALE_TYPE)).toMatch(/no-restricted-syntax/);
  });

  it('allows every named step of the scale', () => {
    expect(lint('components/__design_probe.ts', ON_SCALE_TYPE)).toBe('');
  });

  it('blocks an arbitrary page width', () => {
    expect(lint('app/__design_probe.ts', ARBITRARY_WIDTH)).toMatch(/no-restricted-syntax/);
  });

  it('allows the three page widths and the named inner sizes', () => {
    expect(lint('app/__design_probe.ts', NAMED_WIDTH)).toBe('');
  });

  it('blocks a hex colour in a class string, even a template one', () => {
    expect(lint('components/__design_probe.ts', RAW_HEX)).toMatch(/no-restricted-syntax/);
  });

  it('blocks a raw Tailwind palette colour', () => {
    expect(lint('components/__design_probe.ts', RAW_PALETTE)).toMatch(/no-restricted-syntax/);
  });
});

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

describe('the vault provider boundary', () => {
  it('blocks the GitHub source from a page', () => {
    expect(lint('app/__boundary_probe.ts', VAULT_PROVIDER_IMPORT)).toMatch(
      /no-restricted-imports/,
    );
  });

  it('blocks it from a component', () => {
    expect(lint('components/__boundary_probe.ts', VAULT_PROVIDER_IMPORT)).toMatch(
      /no-restricted-imports/,
    );
  });

  it('still applies inside the exempted cron routes', () => {
    // The cron may hold the service-role client; it still must not know the
    // vault is in git. Those are separate privileges and only one is granted.
    expect(lint('app/api/cron/__boundary_probe.ts', VAULT_PROVIDER_IMPORT)).toMatch(
      /no-restricted-imports/,
    );
  });
});

/**
 * The learn module reaches addresses nobody here chose.
 *
 * Every other integration talks to a host we picked -- GitHub, Gmail, eBay.
 * This one fetches URLs a model produced from text a stranger wrote, from a
 * server with an outbound position no browser has. lib/learn/providers/fetch
 * refuses private and link-local addresses on every redirect hop; that guard
 * is worth nothing if a page can call fetch itself, so the import is closed
 * off and this is what proves the rule fires.
 */
describe('the learn fetch boundary', () => {
  it('blocks the fetcher from a page', () => {
    expect(lint('app/__boundary_probe.ts', LEARN_FETCH_IMPORT)).toMatch(
      /no-restricted-imports/,
    );
  });

  it('blocks it from a component', () => {
    expect(lint('components/__boundary_probe.ts', LEARN_FETCH_IMPORT)).toMatch(
      /no-restricted-imports/,
    );
  });

  it('still applies inside the exempted cron routes', () => {
    expect(lint('app/api/cron/__boundary_probe.ts', LEARN_FETCH_IMPORT)).toMatch(
      /no-restricted-imports/,
    );
  });
});

/**
 * A calendar file is read in one place.
 *
 * ical.js was taken on for repeating appointments, which means its bugs are
 * this app's now. The fence is what keeps swapping it a job in one directory
 * rather than a search, and this is what proves the fence fires.
 */
describe('the calendar library boundary', () => {
  it('blocks the library from a page', () => {
    expect(lint('app/__boundary_probe.ts', ICAL_IMPORT)).toMatch(/no-restricted-imports/);
  });

  it('blocks it from a component', () => {
    expect(lint('components/__boundary_probe.ts', ICAL_IMPORT)).toMatch(/no-restricted-imports/);
  });

  it('still applies inside the exempted cron routes', () => {
    expect(lint('app/api/cron/__boundary_probe.ts', ICAL_IMPORT)).toMatch(
      /no-restricted-imports/,
    );
  });
});

/**
 * The shared link is a window, never an engine.
 *
 * Every case here is a plausible edit rather than a hypothetical: the sell
 * loader is where a price would come from, the BGG provider is where a missing
 * cover would come from, and a bare fetch is what someone reaches for when
 * neither import is available.
 */
describe('the share-read boundary', () => {
  it('blocks the sell loader, which bills per lookup on its estimate path', () => {
    expect(lint('app/s/__boundary_probe.ts', SELL_IMPORT)).toMatch(/no-restricted-imports/);
  });

  it('blocks the BGG provider, which is rate-limited against someone else', () => {
    expect(lint('app/s/__boundary_probe.ts', BGG_IMPORT)).toMatch(/no-restricted-imports/);
  });

  it('blocks the FX fetcher', () => {
    expect(lint('lib/share/read/__boundary_probe.ts', FX_IMPORT)).toMatch(
      /no-restricted-imports/,
    );
  });

  it('blocks the Anthropic SDK outright', () => {
    expect(lint('app/api/s/__boundary_probe.ts', ANTHROPIC_IMPORT)).toMatch(
      /no-restricted-imports/,
    );
  });

  it('blocks a bare fetch, which needs no import at all', () => {
    expect(lint('app/s/__boundary_probe.ts', BARE_FETCH)).toMatch(/no-restricted-globals/);
  });

  /**
   * The overlap trap, asserted rather than trusted.
   *
   * `app/s/**` also matches renderBoundaries' glob. ESLint keeps only the last
   * entry setting `no-restricted-imports` for a file, so if someone trims the
   * repeated pattern groups out of shareReadBoundaries, the service-role rule
   * silently switches off for exactly the pages a stranger can open. These two
   * are what fail when that happens.
   */
  it('still blocks the service-role client on the shared page', () => {
    expect(lint('app/s/__boundary_probe.ts', SERVICE_ROLE_IMPORT)).toMatch(
      /no-restricted-imports/,
    );
  });

  it('still blocks the vault provider on the shared page', () => {
    expect(lint('app/s/__boundary_probe.ts', VAULT_PROVIDER_IMPORT)).toMatch(
      /no-restricted-imports/,
    );
  });

  it('leaves the rest of the app free to use the sell loader', () => {
    expect(lint('app/__boundary_probe.ts', SELL_IMPORT)).toBe('');
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
