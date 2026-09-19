/**
 * The page a newsletter is shown as, inside the reading frame.
 *
 * The frame is an iframe with no origin of its own: it is loaded from `srcdoc`
 * under a sandbox that withholds `allow-same-origin`, so what runs in it cannot
 * read a cookie, a token or anything else belonging to the app. #445 settled
 * that an issue should look the way its sender made it, and this is the room it
 * gets to do that in.
 *
 * The document here is the sender's markup, already cleaned by
 * lib/news/issues/sanitize.ts, wrapped in the little the app insists on: a
 * viewport, a white ground to sit on, and the handful of rules that stop a
 * 600-pixel table from running off the side of a phone.
 */

/**
 * What the app insists on, and no more.
 *
 * Mail is laid out in tables with a fixed pixel width, 600 of them by
 * convention, and on a phone that is wider than the screen. Capping the width
 * is what makes the cells reflow, so the issue reads down the page instead of
 * off the side of it.
 *
 * The cap has to be measured against the viewport rather than written as
 * `max-width: 100%`. A percentage is measured against the containing block,
 * and the block containing a newsletter's 600-pixel table is almost always a
 * cell that is itself sized by its contents. That is circular, so the browser
 * ignores the percentage and the table keeps its 600 pixels. `100vw` is a
 * length the browser can resolve, which is why the rule below is written that
 * way and why the padding is a variable: the cap and the padding it has to
 * account for cannot be allowed to drift apart.
 *
 * A cap cannot take a table below the width of its own contents, so it does
 * not help the two-column layout, where a 600-pixel shell holds a pair of
 * 300-pixel tables and the pair is the content. The second rule is for that
 * one: a table nested inside another, asking for a width in pixels, is given
 * the width it fits in instead. The outer shell still decides the layout, so
 * on a wide screen the columns are where the sender put them.
 *
 * Both rules only ever narrow an issue. A 600-pixel newsletter on a wide
 * screen is still 600 pixels, which is the width its sender designed it at.
 *
 * `min(100%, …)` would read better than the two rules and does not work: the
 * percentage inside it resolves against the same circular containing block and
 * takes the cap with it. It was measured, not assumed.
 */
/** The stamp on every message the frame sends, so the page can tell them apart. */
const FRAME_MARK = 'news-frame';

const FRAME_STYLES = `
  :root { --frame-pad: 16px; }
  html { -webkit-text-size-adjust: 100%; }
  body {
    margin: 0;
    padding: var(--frame-pad);
    background: #ffffff;
    color: #111111;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    font-size: 16px;
    line-height: 1.5;
    overflow-wrap: anywhere;
  }
  td, th, pre, video { max-width: 100% !important; }
  img, table { max-width: calc(100vw - var(--frame-pad) * 2) !important; }
  table table[width]:not([width$="%"]) { width: auto !important; }
  img { height: auto; }
  table { border-collapse: collapse; }
  a { color: inherit; }
`;

/**
 * What the app's own few lines inside the frame do.
 *
 * Two jobs, both settled by decisions. #459: the frame measures itself and
 * says how tall it is, so the page can give it that height and the newsletter
 * reads as part of the page rather than through a letterbox with its own
 * scrollbar. #462: a click on a link is caught here and the address is passed
 * out, because a sandboxed frame cannot open a tab itself and should not be
 * given permission to try.
 *
 * The messages go out to any origin, deliberately. The frame has no origin of its
 * own -- that is what the sandbox is for -- so it cannot name the page it is
 * talking to. Nothing secret is in either message, and the page ignores
 * anything that did not come from this frame's own window.
 */
const FRAME_SCRIPT = `
(function () {
  function send(message) { parent.postMessage(message, '*'); }

  var last = 0;
  function measure() {
    var d = document.documentElement;
    var b = document.body;
    var height = Math.max(
      d.scrollHeight, d.offsetHeight,
      b ? b.scrollHeight : 0, b ? b.offsetHeight : 0
    );
    if (height === last) return;
    last = height;
    send({ source: '${FRAME_MARK}', kind: 'height', height: height });
  }

  // A late picture is the case this exists for: the height is right when the
  // markup lands and wrong again a second later when the images arrive.
  document.addEventListener('DOMContentLoaded', measure);
  window.addEventListener('load', measure);
  window.addEventListener('resize', measure);
  document.addEventListener('load', measure, true);
  document.addEventListener('error', measure, true);
  if (window.ResizeObserver) {
    new ResizeObserver(measure).observe(document.documentElement);
  }
  measure();

  document.addEventListener('click', function (event) {
    var node = event.target;
    while (node && node.nodeName !== 'A') node = node.parentNode;
    if (!node) return;
    var href = node.getAttribute('href');
    event.preventDefault();
    if (href) send({ source: '${FRAME_MARK}', kind: 'open', href: href });
  });
})();
`;

/** A message the frame sends the page. */
export type FrameMessage = { kind: 'height'; height: number } | { kind: 'open'; href: string };

/**
 * How tall the page will let a newsletter make its frame.
 *
 * A number arriving from inside the frame decides the height of an element on
 * the page, so it is capped. Nothing readable is 40,000 pixels long, and a
 * frame that tall is a broken measurement rather than a long newsletter.
 */
const MAX_FRAME_HEIGHT = 40_000;

/** The schemes a link in a newsletter may open. Everything else is ignored. */
const OPENABLE = /^(https?|mailto|tel):/i;

/**
 * Read a message from the frame, or nothing.
 *
 * `from` is the window the message came from and `frame` is the frame's own
 * window: any other sender is ignored outright, which is what stops another
 * frame, another tab or an extension from resizing the page or opening a tab
 * through this. Then the message has to be one of the two shapes above, with
 * a height that is a sane number or an address that can actually be opened.
 */
export function frameMessage(data: unknown, from: unknown, frame: unknown): FrameMessage | null {
  if (!frame || from !== frame) return null;
  if (typeof data !== 'object' || data === null) return null;

  const message = data as { source?: unknown; kind?: unknown; height?: unknown; href?: unknown };
  if (message.source !== FRAME_MARK) return null;

  if (message.kind === 'height') {
    const height = message.height;
    if (typeof height !== 'number' || !Number.isFinite(height)) return null;
    if (height <= 0 || height > MAX_FRAME_HEIGHT) return null;
    return { kind: 'height', height: Math.ceil(height) };
  }

  if (message.kind === 'open') {
    const href = message.href;
    if (typeof href !== 'string' || !OPENABLE.test(href.trim())) return null;
    return { kind: 'open', href: href.trim() };
  }

  return null;
}

/** The whole document the frame is given, newsletter and all. */
export function issueDocument(html: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>${FRAME_STYLES}</style>
<script>${FRAME_SCRIPT}</script>
</head>
<body>
${html}
</body>
</html>`;
}
