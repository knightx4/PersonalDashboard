import { describe, expect, it } from 'vitest';
import { parseAskInput } from './ask-input';
import { bodyWithFileNames, turnFilesRef } from './talk';

const USER = '11111111-1111-4111-8111-111111111111';
const FILE = {
  path: `${USER}/22222222-2222-4222-8222-222222222222-menu.pdf`,
  name: 'menu.pdf',
  contentType: 'application/pdf',
  size: 1200,
};

describe('parseAskInput files', () => {
  it('keeps the files that are in the person own folder', () => {
    const checked = parseAskInput('What is on this?', null, null, [FILE], USER);
    expect(checked).toMatchObject({ ok: true, input: { files: [FILE] } });
  });

  it('leaves out a file in somebody else folder', () => {
    const other = { ...FILE, path: FILE.path.replace(USER, '33333333-3333-4333-8333-333333333333') };
    const checked = parseAskInput('What is on this?', null, null, [other, FILE], USER);
    expect(checked).toMatchObject({ ok: true, input: { files: [FILE] } });
  });

  it('takes no files when none are sent or the person is not given', () => {
    expect(parseAskInput('Hi', null, null)).toMatchObject({ ok: true, input: { files: [] } });
    expect(parseAskInput('Hi', null, null, [FILE])).toMatchObject({ ok: true, input: { files: [] } });
  });
});

describe('turn files', () => {
  it('records them under the turn ref', () => {
    expect(turnFilesRef('abc')).toBe('core.conversation_turns:abc');
  });

  it('names them to the model after the words', () => {
    const file = { id: 'f', name: 'menu.pdf', contentType: 'application/pdf', size: 1, href: '/attachments/f' };
    expect(bodyWithFileNames({ body: 'Look', files: [file, { ...file, name: 'b.png' }] })).toBe(
      'Look\n\n(Sent with this: menu.pdf, b.png)',
    );
    expect(bodyWithFileNames({ body: 'Look' })).toBe('Look');
  });
});
