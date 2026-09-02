/**
 * Which open pursuit a message belongs to, when its title does not match.
 *
 * The reported bug: Adonis had "Finance Manager" and "Role from email" open
 * side by side, both inferred, both in process, both from the same
 * conversation -- because the dedupe compared titles exactly and a title the
 * model could not read never matches one it could.
 */
import { describe, expect, it } from 'vitest';
import {
  choosePursuit,
  PLACEHOLDER_ROLE_TITLE,
  type KnownPursuit,
} from '@/lib/jobs/inbox/ingest-messages';

function pursuit(over: Partial<KnownPursuit> = {}): KnownPursuit {
  return {
    roleId: 'r-1',
    roleTitle: 'Finance Manager',
    applicationId: 'a-1',
    closed: false,
    ...over,
  };
}

const closed = (over: Partial<KnownPursuit> = {}) => pursuit({ closed: true, ...over });

const placeholder = (over: Partial<KnownPursuit> = {}) =>
  pursuit({ roleId: 'r-p', applicationId: 'a-p', roleTitle: PLACEHOLDER_ROLE_TITLE, ...over });

describe('matching on the title', () => {
  it('adopts the open pursuit with the same title', () => {
    expect(choosePursuit([pursuit()], 'Finance Manager')).toEqual({
      kind: 'adopt',
      applicationId: 'a-1',
    });
  });

  it('ignores case, because a subject line does not', () => {
    expect(choosePursuit([pursuit()], 'finance manager')).toEqual({
      kind: 'adopt',
      applicationId: 'a-1',
    });
  });

  it('creates one when the company has nothing open', () => {
    expect(choosePursuit([], 'Finance Manager')).toEqual({ kind: 'create' });
  });
});

describe('a message whose role the model could not read', () => {
  it('joins the one open pursuit instead of opening a nameless second', () => {
    expect(choosePursuit([pursuit()], PLACEHOLDER_ROLE_TITLE)).toEqual({
      kind: 'adopt',
      applicationId: 'a-1',
    });
  });

  it('opens its own rather than guessing between several', () => {
    // Attaching mail to the wrong role is worse than a duplicate you can see.
    expect(
      choosePursuit(
        [pursuit(), pursuit({ roleId: 'r-2', applicationId: 'a-2', roleTitle: 'Controller' })],
        PLACEHOLDER_ROLE_TITLE,
      ),
    ).toEqual({ kind: 'create' });
  });

  it('joins an existing placeholder rather than making a second one', () => {
    expect(choosePursuit([placeholder()], PLACEHOLDER_ROLE_TITLE)).toEqual({
      kind: 'adopt',
      applicationId: 'a-p',
    });
  });
});

describe('a message that finally names the role', () => {
  it('renames the placeholder instead of opening a named twin', () => {
    // The Adonis case, in one line.
    expect(choosePursuit([placeholder()], 'Finance Manager')).toEqual({
      kind: 'rename',
      applicationId: 'a-p',
      roleId: 'r-p',
    });
  });

  it('leaves a named pursuit alone and renames only the placeholder', () => {
    expect(
      choosePursuit([pursuit({ roleTitle: 'Controller' }), placeholder()], 'Finance Manager'),
    ).toEqual({ kind: 'rename', applicationId: 'a-p', roleId: 'r-p' });
  });

  it('creates rather than picking between two placeholders', () => {
    expect(
      choosePursuit(
        [placeholder(), placeholder({ roleId: 'r-p2', applicationId: 'a-p2' })],
        'Finance Manager',
      ),
    ).toEqual({ kind: 'create' });
  });

  it('prefers an exact title match over renaming a placeholder', () => {
    expect(choosePursuit([placeholder(), pursuit()], 'Finance Manager')).toEqual({
      kind: 'adopt',
      applicationId: 'a-1',
    });
  });
});

describe('a pursuit that is already over', () => {
  it('adopts it by name rather than opening a twin', () => {
    // The EliseAI case. A rejection closes the pursuit; every later message
    // about the same job used to match nothing and open another row, which was
    // closed in turn -- sixteen applications at one employer, five of them
    // carrying this identical title.
    expect(choosePursuit([closed()], 'Finance Manager')).toEqual({
      kind: 'adopt',
      applicationId: 'a-1',
    });
  });

  it('reads the title through punctuation and spacing', () => {
    // The same posting quoted out of two different emails.
    expect(
      choosePursuit(
        [closed({ roleTitle: 'Engagement Lead, Future Platforms | Housing' })],
        'Engagement Lead — Future Platforms / Housing',
      ),
    ).toEqual({ kind: 'adopt', applicationId: 'a-1' });
  });

  it('still keeps a different seniority apart', () => {
    // roleIdentityKey forgives punctuation, never a word: these are two jobs.
    expect(choosePursuit([closed({ roleTitle: 'Senior Analyst' })], 'Analyst')).toEqual({
      kind: 'create',
    });
  });

  it('prefers the attempt still running when a role was re-applied to', () => {
    expect(
      choosePursuit([closed(), pursuit({ roleId: 'r-2', applicationId: 'a-live' })], 'Finance Manager'),
    ).toEqual({ kind: 'adopt', applicationId: 'a-live' });
  });

  it('does not let a closed pursuit collect mail that names no role', () => {
    // Which of a company's dead roles an untitled message belongs to is exactly
    // the guess the placeholder rules exist to refuse.
    expect(choosePursuit([closed()], PLACEHOLDER_ROLE_TITLE)).toEqual({ kind: 'create' });
  });

  it('does not rename a closed placeholder to claim a named message', () => {
    expect(choosePursuit([closed({ roleTitle: PLACEHOLDER_ROLE_TITLE })], 'Finance Manager')).toEqual(
      { kind: 'create' },
    );
  });
});

describe('several nameless rows at one company', () => {
  it('joins an existing placeholder even once it is closed', () => {
    // Neither row claims a title, so joining them discards nothing. This is
    // what stops a company accumulating six "Role from email" pursuits.
    expect(
      choosePursuit([closed({ roleTitle: PLACEHOLDER_ROLE_TITLE })], PLACEHOLDER_ROLE_TITLE),
    ).toEqual({ kind: 'adopt', applicationId: 'a-1' });
  });

  it('prefers a live placeholder to a closed one', () => {
    expect(
      choosePursuit(
        [
          closed({ roleTitle: PLACEHOLDER_ROLE_TITLE }),
          pursuit({ roleTitle: PLACEHOLDER_ROLE_TITLE, roleId: 'r-p2', applicationId: 'a-live' }),
        ],
        PLACEHOLDER_ROLE_TITLE,
      ),
    ).toEqual({ kind: 'adopt', applicationId: 'a-live' });
  });
});
