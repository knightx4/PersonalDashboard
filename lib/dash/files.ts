import type Anthropic from '@anthropic-ai/sdk';
import { docxText } from '@/lib/goals/docx';

/**
 * The files sent with the newest question, as Dash reads them (plan #1716,
 * feature #1711). A picture goes to the model as an image block and a PDF as
 * a document block, in the shape lib/goals/extract-model.ts already sends.
 * A Word, text or CSV file goes as its text. Earlier questions' files are
 * not sent again: the history names them (bodyWithFileNames in
 * lib/talk/talk.ts).
 *
 * A file that cannot be read is still named to Dash, with the reason, so the
 * answer can say so rather than act as though nothing was sent: an old .doc
 * (only .docx has a text reader here), a picture over the model's size limit,
 * a PDF over its page limit, or files past what one request can carry.
 */

type ImageType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';

export type DashFile =
  | { name: string; kind: 'image'; mediaType: ImageType; data: string }
  | { name: string; kind: 'pdf'; data: string }
  | { name: string; kind: 'text'; text: string }
  | { name: string; kind: 'unread'; why: string };

/** The model refuses a picture over 5 MB of base64, which is about 3.75 MB of file. */
export const IMAGE_MAX_BYTES = 3_750_000;

/** The model reads a PDF of up to 100 pages. */
export const PDF_MAX_PAGES = 100;

/**
 * The most file bytes one question sends. A request is refused over 32 MB,
 * and base64 adds a third, so 20 MB of files leaves room for the rest.
 */
export const SEND_MAX_BYTES = 20 * 1024 * 1024;

/** A text file longer than this is cut, which is about 25,000 tokens. */
export const TEXT_MAX_CHARS = 100_000;

const IMAGE_TYPES = new Set<string>(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/**
 * How many pages a PDF says it has, by counting its page objects, or null
 * when it keeps them where this cannot see (a compressed object stream).
 */
export function pdfPageCount(bytes: Uint8Array): number | null {
  const text = new TextDecoder('latin1').decode(bytes);
  const count = text.match(/\/Type\s*\/Page(?![a-zA-Z])/g)?.length ?? 0;
  return count > 0 ? count : null;
}

function cut(text: string): string {
  return text.length > TEXT_MAX_CHARS ? `${text.slice(0, TEXT_MAX_CHARS)}\n[cut here: the file goes on]` : text;
}

/** One stored file, as Dash will read it. */
export function readFile(name: string, contentType: string, bytes: Uint8Array): DashFile {
  if (IMAGE_TYPES.has(contentType)) {
    if (bytes.length > IMAGE_MAX_BYTES) {
      return { name, kind: 'unread', why: 'the picture is over the 3.75 MB Dash can look at' };
    }
    return { name, kind: 'image', mediaType: contentType as ImageType, data: Buffer.from(bytes).toString('base64') };
  }
  if (contentType === 'application/pdf') {
    const pages = pdfPageCount(bytes);
    if (pages !== null && pages > PDF_MAX_PAGES) {
      return { name, kind: 'unread', why: `it has ${pages} pages and Dash reads up to ${PDF_MAX_PAGES}` };
    }
    return { name, kind: 'pdf', data: Buffer.from(bytes).toString('base64') };
  }
  if (contentType === DOCX) {
    const text = docxText(bytes);
    if (text === null) return { name, kind: 'unread', why: 'it could not be opened as a Word document' };
    return { name, kind: 'text', text: cut(text) };
  }
  if (contentType === 'text/plain' || contentType === 'text/csv') {
    return { name, kind: 'text', text: cut(new TextDecoder().decode(bytes)) };
  }
  if (contentType === 'application/msword') {
    return { name, kind: 'unread', why: 'an old .doc file cannot be read; saved as .docx or PDF it can' };
  }
  return { name, kind: 'unread', why: 'Dash cannot read this kind of file' };
}

/** The bytes a file costs the request: base64 is a third larger than the file. */
function sentBytes(file: DashFile): number {
  if (file.kind === 'image' || file.kind === 'pdf') return file.data.length;
  if (file.kind === 'text') return file.text.length;
  return 0;
}

/**
 * Keeps files in the order sent until the request would be too large; the
 * rest are named as unread.
 */
export function withinRequest(files: readonly DashFile[]): DashFile[] {
  let total = 0;
  const limit = Math.ceil((SEND_MAX_BYTES * 4) / 3);
  return files.map((file) => {
    const size = sentBytes(file);
    if (size === 0) return file;
    if (total + size > limit) {
      return { name: file.name, kind: 'unread', why: 'the files sent with this question are too large to read all at once' };
    }
    total += size;
    return file;
  });
}

/** The blocks that go before the question's words, in the order the files were sent. */
export function fileBlocks(files: readonly DashFile[]): Anthropic.ContentBlockParam[] {
  const blocks: Anthropic.ContentBlockParam[] = [];
  const unread: string[] = [];
  for (const file of files) {
    if (file.kind === 'image') {
      blocks.push({ type: 'text', text: `(Sent with this: ${file.name})` });
      blocks.push({ type: 'image', source: { type: 'base64', media_type: file.mediaType, data: file.data } });
    } else if (file.kind === 'pdf') {
      blocks.push({
        type: 'document',
        title: file.name,
        source: { type: 'base64', media_type: 'application/pdf', data: file.data },
      });
    } else if (file.kind === 'text') {
      blocks.push({ type: 'text', text: `<file name="${file.name}">\n${file.text}\n</file>` });
    } else {
      unread.push(`${file.name} (${file.why})`);
    }
  }
  if (unread.length > 0) {
    blocks.push({ type: 'text', text: `(Also sent with this, but not readable: ${unread.join('; ')})` });
  }
  return blocks;
}
