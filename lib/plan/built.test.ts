import { describe, expect, it } from 'vitest';
import { builtBeneathExpiries, endsWithBuiltLine } from './built';

const BUILT = 'Added by a session.\n\nBuilt 2026-10-28 on plan/2593 (64902d4af): the accounts page.';
const EXPIRED =
  'Claim expired 2026-10-28: nothing had touched it for 5h 10m, so it went back to not started.';

describe('builtBeneathExpiries', () => {
  it('reads a step ending on its Built line', () => {
    expect(builtBeneathExpiries(BUILT)).toBe(true);
  });

  it('reads a step the sweep took back once or twice after it was built', () => {
    expect(builtBeneathExpiries(`${BUILT}\n\n${EXPIRED}`)).toBe(true);
    expect(builtBeneathExpiries(`${BUILT}\n\n${EXPIRED}\n\n${EXPIRED}`)).toBe(true);
    expect(endsWithBuiltLine(`${BUILT}\n\n${EXPIRED}`)).toBe(false);
  });

  it('leaves a step whose last word after the Built line is anything else', () => {
    expect(builtBeneathExpiries(`${BUILT}\n\nBlocked 2026-10-29: waits on the keys.`)).toBe(false);
    expect(builtBeneathExpiries(`${BUILT}\n\n${EXPIRED}\n\nDone 2026-11-01: on main.`)).toBe(false);
  });

  it('leaves a step that was never built', () => {
    expect(builtBeneathExpiries(`Added by a session.\n\n${EXPIRED}`)).toBe(false);
    expect(builtBeneathExpiries(null)).toBe(false);
    expect(builtBeneathExpiries('')).toBe(false);
  });
});
