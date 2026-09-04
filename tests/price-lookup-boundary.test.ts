/**
 * Every price lookup goes through lib/sell/price-lookup.ts.
 *
 * When the sources learned to return the listings behind a number, three
 * callers reached for the provider directly and only one was updated — so the
 * item page the feature was built for kept showing a bare figure, and the bug
 * looked like a deploy problem rather than a missed call site. The wrapper
 * exists so a new capability reaches every caller at once; this test is what
 * stops a fourth caller quietly going around it.
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

/** Where calling the provider directly is the point, not a mistake. */
const ALLOWED = new Set([
  // Declares the interface and implements it.
  'lib/sell/expected-price.ts',
  // The other implementation.
  'lib/sell/web-estimate.ts',
  // The wrapper itself.
  'lib/sell/price-lookup.ts',
  // Probes a source it constructed itself to prove the credentials work. It is
  // a connection test, not a price lookup for an item, and it wants the bare
  // number -- routing it through the wrapper would buy nothing.
  'lib/sell/ebay-check.ts',
]);

// Only a call. `row.expectedSelfListCents != null` is a field read on a row,
// which is not a lookup and must not be flagged as one.
const CALLS = /\.(expectedSelfListCents|expectedSelfListCentsFor|priceEvidence|priceEvidenceForIsbn)\s*\(/;

function trackedSourceFiles(): string[] {
  // --others as well as tracked: a brand new caller is exactly the thing this
  // is guarding against, and it would not be in the index yet.
  return execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', 'app', 'lib', 'inngest', 'scripts'],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
    },
  )
    .split('\n')
    .filter((f) => /\.(ts|tsx)$/.test(f) && !f.endsWith('.test.ts') && !f.endsWith('.test.tsx'));
}

describe('price lookups go through one wrapper', () => {
  it('has no caller reaching past it', () => {
    const offenders = trackedSourceFiles().filter(
      (file) => !ALLOWED.has(file) && CALLS.test(readFileSync(file, 'utf8')),
    );

    expect(
      offenders,
      'Call lookupPriceByIsbn / lookupPriceBySubject from @/lib/sell/price-lookup instead',
    ).toEqual([]);
  });

  it('is watching real files, so the check cannot pass by finding nothing', () => {
    const files = trackedSourceFiles();
    expect(files.length).toBeGreaterThan(50);
    // The allow-list must name files that exist, or it is quietly stale.
    for (const allowed of ALLOWED) expect(files).toContain(allowed);
  });
});
