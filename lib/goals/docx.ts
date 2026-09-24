/**
 * The text of a Word (.docx) file, for filling a form from it (plan #955).
 *
 * A .docx is a zip holding XML, and the text is in word/document.xml. The
 * model reads PDFs and images itself but not Word files, so the text is taken
 * out here and sent as plain text. Paragraphs and table cells keep their
 * breaks, which is what lets a table of loans still read as rows. Formatting,
 * headers, footers and images are left behind.
 *
 * Written against the zip layout directly, with node's inflate, rather than
 * with a library: reading one entry needs only the central directory, and
 * nothing else in the app reads zips.
 */

import { inflateRawSync } from 'node:zlib';

const END_OF_DIRECTORY = 0x06054b50;
const DIRECTORY_ENTRY = 0x02014b50;
const LOCAL_HEADER = 0x04034b50;
const ENTRY = 'word/document.xml';
/** A document.xml larger than this is not a statement. */
const XML_MAX = 50 * 1024 * 1024;

/** The document's text, or null when the file is not a Word document this can read. */
export function docxText(file: Uint8Array): string | null {
  const xml = zipEntry(file, ENTRY);
  return xml === null ? null : documentXmlText(xml);
}

function zipEntry(file: Uint8Array, wanted: string): string | null {
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  // The end record is in the last 22 bytes plus a comment of up to 64 KB.
  let end = -1;
  for (let i = file.length - 22; i >= Math.max(0, file.length - 22 - 65_535); i--) {
    if (view.getUint32(i, true) === END_OF_DIRECTORY) {
      end = i;
      break;
    }
  }
  if (end < 0) return null;

  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const decoder = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (at + 46 > file.length || view.getUint32(at, true) !== DIRECTORY_ENTRY) return null;
    const method = view.getUint16(at + 10, true);
    const compressed = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const name = decoder.decode(file.subarray(at + 46, at + 46 + nameLength));
    at += 46 + nameLength + extraLength + commentLength;
    if (name !== wanted) continue;

    if (local + 30 > file.length || view.getUint32(local, true) !== LOCAL_HEADER) return null;
    const start =
      local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const body = file.subarray(start, start + compressed);
    if (body.length !== compressed) return null;
    try {
      if (method === 0) return decoder.decode(body);
      if (method === 8) return decoder.decode(inflateRawSync(body, { maxOutputLength: XML_MAX }));
    } catch {
      return null;
    }
    return null;
  }
  return null;
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

/** The text in word/document.xml, a line per paragraph and a tab between table cells. */
export function documentXmlText(xml: string): string {
  return xml
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<w:(br|cr)\b[^>]*\/>/g, '\n')
    .replace(/<\/w:tc>/g, '\t')
    .replace(/<\/w:(p|tr)>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
      if (code[0] === '#') {
        const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : match;
      }
      return ENTITIES[code.toLowerCase()] ?? match;
    })
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
