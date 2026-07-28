/**
 * Decode a Gmail API message payload into plain text (ephemeral — never persist).
 */

interface MimePart {
  mimeType?: string;
  filename?: string;
  body?: { data?: string; size?: number };
  parts?: MimePart[];
}

function decodeBase64Url(data: string): string {
  const normalized = data.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(normalized, 'base64').toString('utf8');
}

function collectParts(part: MimePart | undefined, out: { text: string[]; html: string[] }) {
  if (!part) return;
  const mime = (part.mimeType ?? '').toLowerCase();
  if (part.body?.data) {
    const decoded = decodeBase64Url(part.body.data);
    if (mime.includes('text/plain')) out.text.push(decoded);
    else if (mime.includes('text/html')) out.html.push(decoded);
  }
  for (const child of part.parts ?? []) collectParts(child, out);
}

function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

export function gmailPayloadToText(payload: MimePart | undefined): string {
  const out = { text: [] as string[], html: [] as string[] };
  collectParts(payload, out);
  if (out.text.length) return out.text.join('\n\n');
  if (out.html.length) return htmlToText(out.html.join('\n'));
  return '';
}

export function headerValue(
  headers: Array<{ name?: string; value?: string }> | undefined,
  name: string,
): string | null {
  if (!headers) return null;
  const hit = headers.find((h) => h.name?.toLowerCase() === name.toLowerCase());
  return hit?.value ?? null;
}
