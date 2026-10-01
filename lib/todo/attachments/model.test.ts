import { describe, expect, it } from 'vitest';
import {
  checkUpload,
  cleanFileName,
  formatBytes,
  groupAttachments,
  guessRole,
  MAX_ATTACHMENT_BYTES,
  resolveMimeType,
  storagePathFor,
  type AttachmentView,
} from './model';

const view = (over: Partial<AttachmentView>): AttachmentView => ({
  id: 'a',
  kind: 'file',
  role: 'other',
  name: 'x',
  note: null,
  mimeType: 'application/pdf',
  sizeBytes: 10,
  fromEmailId: null,
  emailFrom: null,
  emailSentAt: null,
  emailText: null,
  emailGmailUrl: null,
  createdAt: '2026-10-01T00:00:00Z',
  ...over,
});

describe('checkUpload', () => {
  it('accepts a PDF', () => {
    expect(checkUpload({ name: 'tickets.pdf', type: 'application/pdf', size: 1000 })).toEqual({
      ok: true,
      name: 'tickets.pdf',
      mimeType: 'application/pdf',
    });
  });

  it('reads the type from the name when the browser leaves it blank', () => {
    expect(resolveMimeType('IMG_1.HEIC', '')).toBe('image/heic');
    expect(resolveMimeType('a.pkpass', 'application/octet-stream')).toBe(
      'application/vnd.apple.pkpass',
    );
  });

  it('refuses SVG, HTML, an empty file and one over the limit', () => {
    expect(checkUpload({ name: 'a.svg', type: 'image/svg+xml', size: 10 }).ok).toBe(false);
    expect(checkUpload({ name: 'a.html', type: 'text/html', size: 10 }).ok).toBe(false);
    expect(checkUpload({ name: 'a.pdf', type: 'application/pdf', size: 0 }).ok).toBe(false);
    const big = checkUpload({
      name: 'a.pdf',
      type: 'application/pdf',
      size: MAX_ATTACHMENT_BYTES + 1,
    });
    expect(big).toMatchObject({ ok: false });
    if (!big.ok) expect(big.error).toContain('25 MB');
  });
});

describe('names and paths', () => {
  it('drops folders and control characters from a name', () => {
    expect(cleanFileName('C:\\temp\\..\\my\u0000 ticket.pdf')).toBe('my ticket.pdf');
  });

  it('keeps the extension when it cuts a long name', () => {
    const cut = cleanFileName(`${'a'.repeat(300)}.pdf`);
    expect(cut.length).toBe(200);
    expect(cut.endsWith('.pdf')).toBe(true);
  });

  it('puts a file in its owner folder', () => {
    expect(storagePathFor('u1', 'a1')).toBe('u1/a1');
  });

  it('formats sizes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});

describe('guessRole', () => {
  it('calls a ticket a ticket', () => {
    expect(guessRole('Madeon e-ticket.pdf', 'application/pdf')).toBe('ticket');
    expect(guessRole('wallet.pkpass', 'application/vnd.apple.pkpass')).toBe('ticket');
    expect(guessRole('invoice-22.pdf', 'application/pdf')).toBe('receipt');
    expect(guessRole('IMG_20.jpg', 'image/jpeg')).toBe('photo');
    expect(guessRole('notes.txt', 'text/plain')).toBe('document');
  });
});

describe('groupAttachments', () => {
  it('puts a message’s files under it and leaves others alone', () => {
    const email = view({
      id: 'e',
      kind: 'email',
      mimeType: null,
      createdAt: '2026-10-01T02:00:00Z',
    });
    const child = view({ id: 'f', fromEmailId: 'e' });
    const loose = view({ id: 'g', createdAt: '2026-10-01T03:00:00Z' });
    const orphan = view({ id: 'h', fromEmailId: 'gone', createdAt: '2026-10-01T01:00:00Z' });
    const grouped = groupAttachments([child, email, loose, orphan]);
    expect(grouped.map((g) => g.item.id)).toEqual(['g', 'e', 'h']);
    expect(grouped[1].files.map((f) => f.id)).toEqual(['f']);
  });
});

import { searchWordsFor } from './model';

describe('searchWordsFor', () => {
  it('keeps the name of the thing and drops filler', () => {
    expect(searchWordsFor('Madeon live at the Fillmore!')).toBe('madeon fillmore');
    expect(searchWordsFor('The')).toBe('');
  });
});
