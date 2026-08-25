/**
 * Line-heuristic paste parsing (no LLM). Shared by paste-list and tests.
 */
import { extractIsbnFromText } from '@/lib/books/isbn';
import type { ResolveBookInput } from '@/lib/books/types';

export type PasteCandidate = {
  raw: string;
  input: ResolveBookInput;
};

export function heuristicParseLines(text: string): PasteCandidate[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => {
      if (l.length === 0) return false;
      // Keep bare ISBN lines; drop decorative bullets / separators only.
      if (extractIsbnFromText(l)) return true;
      return !/^[-–—*•.\s]+$/.test(l) && !/^\d+[.)]\s*$/.test(l);
    });

  return lines.map((raw) => {
    const isbn = extractIsbnFromText(raw);
    if (isbn && /^\d[\d\- Xx]{8,}$/.test(raw.replace(/\s/g, ''))) {
      return { raw, input: { isbn } };
    }
    if (isbn && /isbn/i.test(raw)) {
      return { raw, input: { isbn } };
    }

    const byMatch = raw.match(/^(.+?)\s+by\s+(.+)$/i);
    if (byMatch) {
      return {
        raw,
        input: { title: byMatch[1]!.trim(), author: byMatch[2]!.trim() },
      };
    }
    const dashMatch = raw.match(/^(.+?)\s+[—–-]\s+(.+)$/);
    if (dashMatch) {
      return {
        raw,
        input: { title: dashMatch[1]!.trim(), author: dashMatch[2]!.trim() },
      };
    }
    // Prefer ISBN embedded in a title line when it's the only strong signal.
    if (isbn && raw.replace(/[\d\-Xx\s]/g, '').length < 4) {
      return { raw, input: { isbn } };
    }
    return { raw, input: { title: raw } };
  });
}
