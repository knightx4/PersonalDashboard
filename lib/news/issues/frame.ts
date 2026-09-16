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
 * `max-width` with `!important` is the rule that matters. Mail is laid out in
 * tables with a fixed pixel width, 600 of them by convention, and on a phone
 * that is wider than the screen -- so the width is capped and the cells reflow,
 * which is how the issue reads down the page instead of off the side of it.
 */
const FRAME_STYLES = `
  html { -webkit-text-size-adjust: 100%; }
  body {
    margin: 0;
    padding: 16px;
    background: #ffffff;
    color: #111111;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    font-size: 16px;
    line-height: 1.5;
    overflow-wrap: anywhere;
  }
  img, table, td, th, pre, video { max-width: 100% !important; }
  img { height: auto; }
  table { border-collapse: collapse; }
  a { color: inherit; }
`;

/** The whole document the frame is given, newsletter and all. */
export function issueDocument(html: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>${FRAME_STYLES}</style>
</head>
<body>
${html}
</body>
</html>`;
}
