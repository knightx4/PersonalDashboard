import { describe, expect, it } from 'vitest';
import { consequenceFrom, consequenceSaid, parseConsequenceArg } from '@/lib/raised/consequence';

describe('what a raise says a yes will do', () => {
  it('reads an action and the thing it works on out of the flag', () => {
    const parsed = parseConsequenceArg('file_idea: Refuse a second session on a step', 'dev');

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.action).toEqual({
      name: 'file_idea',
      text: 'Refuse a second session on a step',
      module: 'dev',
      field: null,
    });
    expect(parsed.said).toBe(
      'Files this on the ideas page, about Dev: Refuse a second session on a step',
    );
  });

  it('reads a name written with spaces or hyphens as the same action', () => {
    for (const written of ['File idea: something', 'file-idea: something', 'FILE_IDEA: something']) {
      const parsed = parseConsequenceArg(written, null);
      expect(parsed.ok, written).toBe(true);
      if (parsed.ok) expect(parsed.action.name).toBe('file_idea');
    }
  });

  it('refuses a name that is not one of the actions', () => {
    const parsed = parseConsequenceArg('approve: the proposal under #12', 'dev');

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.why).toContain('approve');
    expect(parsed.why).toContain('file_idea');
  });

  it('refuses an action with nothing to work on', () => {
    expect(parseConsequenceArg('file_idea', 'dev').ok).toBe(false);
    expect(parseConsequenceArg('file_idea:   ', 'dev').ok).toBe(false);
  });

  it('reads one back off the column with the sentence the page shows', () => {
    const read = consequenceFrom(
      { name: 'send_step', text: '#342', module: null, field: null },
      'dev',
    );

    expect(read?.action.name).toBe('send_step');
    expect(read?.said).toBe('Hands #342 to a session to be built.');
  });

  it('reads nothing at all for a raise filed before there was a column', () => {
    expect(consequenceFrom(null, 'dev')).toBeNull();
    expect(consequenceFrom(undefined, 'dev')).toBeNull();
    expect(consequenceFrom('file_idea: something', 'dev')).toBeNull();
    expect(consequenceFrom([{ name: 'file_idea' }], 'dev')).toBeNull();
    expect(consequenceFrom({ text: 'no name' }, 'dev')).toBeNull();
  });

  it('says the raise module when the action names none', () => {
    expect(consequenceSaid({ name: 'file_idea', text: 'a thing', module: null, field: null }, 'jobs'))
      .toBe('Files this on the ideas page, about Job search: a thing');
    expect(consequenceSaid({ name: 'file_idea', text: 'a thing', module: null, field: null }, null))
      .toBe('Files this on the ideas page, about the app as a whole: a thing');
  });

  it('still says something for a name the list has never had', () => {
    expect(consequenceSaid({ name: 'dance', text: 'a jig', module: null, field: null }, null)).toBe(
      'dance: a jig',
    );
  });
});
