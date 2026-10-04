/**
 * Turning sent emails into voice samples: what the person wrote, without the
 * thread it replied to, the signature block, or mail too long or too short to
 * show how they sound in a short note. Kept apart from voice.ts so it can be
 * tested without Gmail.
 */

/** How many samples the prompt is given. */
export const VOICE_SAMPLES = 6;
const MIN_WORDS = 12;
const MAX_WORDS = 180;
const MAX_CHARS = 900;

/** Where the quoted thread or a forwarded message starts. */
const QUOTE_STARTS = [
  /^On .{0,200}?wrote:\s*$/m,
  /^On .{0,200}\n.{0,200}wrote:\s*$/m,
  /^-{2,}\s*(Original|Forwarded) [Mm]essage\s*-{2,}/m,
  /^_{10,}\s*$/m,
  /^From: .+\n(Sent|Date): /m,
];

/** Where a signature or a mail client's footer starts. */
const SIGNATURE_STARTS = [/^--\s*$/m, /^Sent from my /m, /^Get Outlook for /m];

/** The part of a sent email the person wrote, or null when it is not worth showing. */
export function voiceSample(raw: string): string | null {
  let text = raw.replace(/\r\n?/g, '\n');
  for (const pattern of [...QUOTE_STARTS, ...SIGNATURE_STARTS]) {
    const match = pattern.exec(text);
    if (match) text = text.slice(0, match.index);
  }
  text = text
    .split('\n')
    .filter((line) => !line.startsWith('>'))
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const words = text.split(/\s+/).filter(Boolean).length;
  if (words < MIN_WORDS || words > MAX_WORDS || text.length > MAX_CHARS) return null;
  // Mostly links or an automatic reply: not how they write to a person.
  if ((text.match(/https?:\/\//g) ?? []).length > 2) return null;
  if (/\bunsubscribe\b|out of (the )?office|automatic reply/i.test(text)) return null;
  return text;
}

/** The first VOICE_SAMPLES usable samples, with repeats taken out. */
export function pickVoiceSamples(texts: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of texts) {
    const sample = voiceSample(raw);
    if (!sample) continue;
    const key = sample.toLowerCase().replace(/\s+/g, ' ');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(sample);
    if (out.length >= VOICE_SAMPLES) break;
  }
  return out;
}
