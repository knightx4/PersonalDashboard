import 'server-only';

/**
 * The text layer of a PDF, one string per page, or null when the file cannot
 * be read or has no text (a scan). The provider parsers take this text; the
 * fetch itself is ./fetch's.
 */
export async function extractPdfPages(bytes: Uint8Array): Promise<string[] | null> {
  try {
    const { extractText, getDocumentProxy } = await import('unpdf');
    const pdf = await getDocumentProxy(bytes);
    const { text } = await extractText(pdf, { mergePages: false });
    const pages = (Array.isArray(text) ? text : [text]).map((page) => page.replace(/\0/g, '').trim());
    return pages.some((page) => page !== '') ? pages : null;
  } catch {
    return null;
  }
}
