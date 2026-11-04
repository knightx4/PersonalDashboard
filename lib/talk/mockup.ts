import type { TalkToolCall } from './talk';

/**
 * A quick mockup in a thought-through answer (plan #2789.10). With "Think it
 * through" on, Dash can draw a small page of HTML and CSS to show what it
 * means, such as a layout for a design idea, and the reply draws it in a
 * sandboxed frame under the answer.
 *
 * The mockup is kept as the `show_mockup` call's result in the turn's
 * tool_calls (core.conversation_turns), as a chart is (lib/talk/chart.ts), so
 * a reopened answer draws it again from the turn alone.
 *
 * The frame runs no scripts and reaches nothing: it is drawn with
 * `sandbox=""` and a content security policy that refuses every fetch, so
 * the HTML can only lay itself out. Nothing here reads a database or the
 * network, so the thread imports it.
 */

export const MOCKUP_TOOL = 'show_mockup';

/** The most HTML one mockup keeps: a page of layout, not an app. */
export const MAX_MOCKUP_HTML = 40_000;
export const MAX_MOCKUP_TITLE = 100;
/** The most mockups one answer draws. */
export const MAX_MOCKUPS = 2;

export type DashMockup = { title: string; html: string };

/** What the model is told once a mockup is kept. */
export const MOCKUP_DRAWN = 'The mockup is drawn under your answer. Say in a sentence what it shows; do not repeat the HTML.';

/**
 * Checks a mockup as the model sent it, or as a turn kept it. The error is a
 * sentence for the model, so it can send the mockup again within the limits.
 */
export function parseMockup(input: unknown): { ok: true; mockup: DashMockup } | { ok: false; error: string } {
  const raw = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const title = typeof raw.title === 'string' ? raw.title.replace(/\s+/g, ' ').trim() : '';
  if (!title) return { ok: false, error: 'Give the mockup a title that says what it shows.' };
  if (title.length > MAX_MOCKUP_TITLE) {
    return { ok: false, error: `The title is ${title.length} characters; the most is ${MAX_MOCKUP_TITLE}.` };
  }
  const html = typeof raw.html === 'string' ? raw.html.trim() : '';
  if (!html) return { ok: false, error: 'The mockup needs its HTML.' };
  if (html.length > MAX_MOCKUP_HTML) {
    return {
      ok: false,
      error: `The HTML is ${html.length} characters; the most is ${MAX_MOCKUP_HTML}. Draw less of the page.`,
    };
  }
  if (/<script\b/i.test(html)) {
    return { ok: false, error: 'A mockup runs no scripts. Draw it with HTML and CSS alone.' };
  }
  return { ok: true, mockup: { title, html } };
}

/** The mockups an answer drew, from its kept tool calls, in the order drawn. */
export function turnMockups(calls: readonly TalkToolCall[] | undefined): DashMockup[] {
  const mockups: DashMockup[] = [];
  for (const call of calls ?? []) {
    if (call.name !== MOCKUP_TOOL || !call.result || typeof call.result !== 'object') continue;
    const result = call.result as { ok?: unknown; mockup?: unknown };
    if (result.ok !== true) continue;
    const parsed = parseMockup(result.mockup);
    if (parsed.ok) mockups.push(parsed.mockup);
    if (mockups.length >= MAX_MOCKUPS) break;
  }
  return mockups;
}

/**
 * Refuses everything the frame could reach: no fetch, no script, no font or
 * picture from elsewhere. Inline styles and data: pictures still draw.
 */
export const MOCKUP_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:";

/**
 * The document the frame is given: the mockup's HTML inside a page that sets
 * the policy first, so a mockup that writes its own <head> is still held to it.
 */
export function mockupDocument(mockup: DashMockup): string {
  return [
    '<!doctype html><html><head><meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${MOCKUP_CSP}">`,
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<style>html,body{margin:0;background:#fff;color:#111;font:14px/1.45 system-ui,sans-serif}</style>',
    '</head><body>',
    mockup.html,
    '</body></html>',
  ].join('');
}

export const MOCKUP_TOOL_DEFINITION = {
  name: MOCKUP_TOOL,
  description: `Draw a quick mockup under your answer: a small page of HTML with inline CSS that shows what you mean, such as a layout for a screen or a component in two states. It is drawn in a sandboxed frame about 360 pixels tall that runs no scripts and loads nothing from elsewhere, so put every style inline or in a <style> block and draw pictures as plain shapes. Keep it to the part that matters, at phone width first. Use it only when a picture says it better than words; at most ${MAX_MOCKUPS} for an answer.`,
  input_schema: {
    type: 'object' as const,
    properties: {
      title: { type: 'string', description: 'What the mockup shows: "The Ask box with the switch on".' },
      html: {
        type: 'string',
        description: `The body's HTML, with its CSS inline or in a <style> block. No <script>. At most ${MAX_MOCKUP_HTML} characters.`,
      },
    },
    required: ['title', 'html'],
    additionalProperties: false,
  },
};
