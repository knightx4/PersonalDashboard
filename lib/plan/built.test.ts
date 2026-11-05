import { describe, expect, it } from 'vitest';
import { builtBeneathExpiries, chooseBuiltCommit, endsWithBuiltLine, subjectNamesStep } from './built';

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

describe('chooseBuiltCommit', () => {
  const branch = [
    { sha: 'a33223a7f', subject: 'Draw group chats in Messages (plan #2879.1.3)' },
    { sha: '96e60063', subject: "Keep group talk in each bot's memory (plan #2879.1.4)" },
    { sha: '08ae37d8', subject: 'Run a group burst with a director (plan #2879.1.2)' },
    { sha: '96f67e80', subject: 'Store group chats with two to eight bots (plan #2879.1.1)' },
  ];

  it("records the step's own commit rather than HEAD when another step was committed after it", () => {
    expect(
      chooseBuiltCommit({ number: 2919, outline: '2879.1.1', given: null, givenSubject: null, head: 'a33223a7f', branch }),
    ).toEqual({ commit: '96f67e80', why: 'the newest commit naming #2879.1.1' });
  });

  it('gives a parent the newest commit of any step beneath it', () => {
    const chosen = chooseBuiltCommit({ number: 2880, outline: '2879.1', given: null, givenSubject: null, head: 'a33223a7f', branch });
    expect(chosen).toEqual({ commit: 'a33223a7f', why: 'the newest commit naming #2879.1' });
  });

  it("refuses a given commit that names another step, and names the step's own", () => {
    const chosen = chooseBuiltCommit({
      number: 2919,
      outline: '2879.1.1',
      given: 'a33223a7f',
      givenSubject: branch[0].subject,
      head: 'a33223a7f',
      branch,
    });
    expect('refusal' in chosen && chosen.refusal).toContain('pass --commit 96f67e80');
  });

  it('takes a given merge commit, which names no step, as given', () => {
    expect(
      chooseBuiltCommit({ number: 2919, outline: '2879.1.1', given: 'abae8ce7', givenSubject: 'Merge plan feature #2879', head: null, branch }),
    ).toEqual({ commit: 'abae8ce7', why: 'as given' });
  });

  it('refuses HEAD when it names a different step and nothing names this one', () => {
    const chosen = chooseBuiltCommit({ number: 2999, outline: '2879.9', given: null, givenSubject: null, head: 'a33223a7f', branch });
    expect('refusal' in chosen).toBe(true);
  });

  it('does not take #2879.10 for #2879.1', () => {
    expect(subjectNamesStep('x (plan #2879.10)', 2880, '2879.1')).toBe(false);
  });
});
