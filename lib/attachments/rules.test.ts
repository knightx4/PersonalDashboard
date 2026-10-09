import { describe, expect, it } from 'vitest';
import {
  ATTACHMENT_ACCEPT,
  attachmentContentType,
  attachmentHref,
  attachmentPath,
  attachmentProblem,
  ownsAttachmentPath,
  parseUploadedAttachments,
} from './rules';

const USER = 'd001bb0f-ffe8-4bfb-880f-17dd1a62b685';
const OTHER = '11111111-2222-3333-4444-555555555555';
const ID = '0b9d3c1e-5a4f-4e7b-9c2d-8f6a1b3e5d7c';

describe('attachmentContentType', () => {
  it('takes the types the feature settles, by extension', () => {
    expect(attachmentContentType('Screenshot 2026.PNG')).toBe('image/png');
    expect(attachmentContentType('letter.jpeg')).toBe('image/jpeg');
    expect(attachmentContentType('bill.pdf')).toBe('application/pdf');
    expect(attachmentContentType('cv.docx')).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    expect(attachmentContentType('old.doc')).toBe('application/msword');
    expect(attachmentContentType('notes.txt')).toBe('text/plain');
    expect(attachmentContentType('export.csv')).toBe('text/csv');
  });

  it('refuses anything else', () => {
    expect(attachmentContentType('drawing.svg')).toBeNull();
    expect(attachmentContentType('page.html')).toBeNull();
    expect(attachmentContentType('noextension')).toBeNull();
    expect(ATTACHMENT_ACCEPT).not.toContain('.svg');
  });
});

describe('attachmentProblem', () => {
  it('names a file of the wrong type or over 20 MB', () => {
    expect(attachmentProblem({ name: 'a.png', size: 1000 })).toBeNull();
    expect(attachmentProblem({ name: 'a.exe', size: 1000 })).toMatch(/cannot be added/);
    expect(attachmentProblem({ name: 'a.pdf', size: 21 * 1024 * 1024 })).toBe('a.pdf is over 20 MB.');
  });
});

describe('attachmentPath', () => {
  it('puts a file in your own folder under a fresh id, with a cleaned name', () => {
    const path = attachmentPath(USER, ID, 'Bill from the council (May).pdf');
    expect(path).toBe(`${USER}/${ID}-Bill-from-the-council-May-.pdf`);
    expect(ownsAttachmentPath(USER, path)).toBe(true);
  });

  it('names a file with nothing left of its name', () => {
    expect(attachmentPath(USER, ID, '???')).toBe(`${USER}/${ID}-file`);
  });

  it('does not own a path in another folder, or one it did not make', () => {
    const path = attachmentPath(OTHER, ID, 'a.png');
    expect(ownsAttachmentPath(USER, path)).toBe(false);
    expect(ownsAttachmentPath(USER, `${USER}/../${OTHER}/a.png`)).toBe(false);
    expect(ownsAttachmentPath('', `/${ID}-a.png`)).toBe(false);
  });
});

describe('parseUploadedAttachments', () => {
  const good = {
    path: attachmentPath(USER, ID, 'shot.png'),
    name: 'shot.png',
    contentType: 'image/png',
    size: 2048,
  };

  it('reads the hidden field the picker writes', () => {
    expect(parseUploadedAttachments(JSON.stringify([good]), USER)).toEqual([good]);
    expect(parseUploadedAttachments('', USER)).toEqual([]);
    expect(parseUploadedAttachments('not json', USER)).toEqual([]);
  });

  it('leaves out a file in somebody else folder, of a wrong type, too large or named twice', () => {
    const theirs = { ...good, path: attachmentPath(OTHER, ID, 'shot.png') };
    const svg = { ...good, path: attachmentPath(USER, ID, 'x.svg'), contentType: 'image/svg+xml' };
    const huge = { ...good, path: attachmentPath(USER, ID, 'big.png'), size: 30 * 1024 * 1024 };
    expect(parseUploadedAttachments([good, theirs, svg, huge, good], USER)).toEqual([good]);
  });

  it('keeps five at most', () => {
    const many = Array.from({ length: 7 }, (_, i) => ({
      ...good,
      path: attachmentPath(USER, `0b9d3c1e-5a4f-4e7b-9c2d-8f6a1b3e5d7${i}`, 'shot.png'),
    }));
    expect(parseUploadedAttachments(many, USER)).toHaveLength(5);
  });
});

describe('attachmentHref', () => {
  it('opens through the signing route', () => {
    expect(attachmentHref(ID)).toBe(`/attachments/${ID}`);
  });
});
