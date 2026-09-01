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
  type OpenPursuit,
} from '@/lib/jobs/inbox/ingest-messages';

function pursuit(over: Partial<OpenPursuit> = {}): OpenPursuit {
  return {
    roleId: 'r-1',
    roleTitle: 'Finance Manager',
    applicationId: 'a-1',
    ...over,
  };
}

const placeholder = (over: Partial<OpenPursuit> = {}) =>
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
