import sanitizeHtml from 'sanitize-html';

/**
 * Cleaning a newsletter's HTML on the way out.
 *
 * #445 settled that an issue is shown as its sender designed it, which means
 * the app renders markup written by a stranger. Two things stand between that
 * markup and the account: this function, which takes out everything that can
 * act, and the sandboxed frame it is shown in, which has no access to the page
 * around it. Neither is trusted alone.
 *
 * What comes out is inert: no script, no event handlers, no javascript: links,
 * no form, no frame, no plugin. What survives is what a newsletter is made of --
 * headings, text, links, tables, colours and the inline styles that hold the
 * layout together.
 *
 * Cleaning happens here rather than on the way in, so a better version of this
 * function applies to mail that is already stored and what is kept stays
 * comparable with what was sent.
 */

/** What a clean returns: the markup to show, and what it held back. */
export type CleanIssue = {
  html: string;
  /**
   * How many pictures were left unloaded. Zero when the reader has asked for
   * them, and the number to offer to load when they have not.
   */
  blockedImages: number;
  /** How many pictures the issue has, loaded or not. */
  images: number;
};

/**
 * The tags a newsletter is allowed to be made of.
 *
 * Table markup is in it because email HTML is table markup: a newsletter laid
 * out with `div`s alone is the exception. `style` is not in it -- a stylesheet
 * can pull a remote background in, which would walk around holding pictures
 * back, and almost everything a newsletter does to itself is in an inline
 * style anyway.
 */
const ALLOWED_TAGS = [
  'a',
  'abbr',
  'address',
  'article',
  'aside',
  'b',
  'blockquote',
  'br',
  'caption',
  'center',
  'cite',
  'code',
  'col',
  'colgroup',
  'dd',
  'del',
  'div',
  'dl',
  'dt',
  'em',
  'figcaption',
  'figure',
  'font',
  'footer',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'i',
  'img',
  'ins',
  'li',
  'main',
  'mark',
  'nav',
  'ol',
  'p',
  'pre',
  'q',
  's',
  'section',
  'small',
  'span',
  'strike',
  'strong',
  'sub',
  'sup',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'time',
  'tr',
  'u',
  'ul',
  'wbr',
];

/**
 * The attributes that carry a newsletter's appearance.
 *
 * `style` is here, filtered below. The presentational attributes beside it --
 * `bgcolor`, `align`, `width` and the rest -- are how mail from the last twenty
 * years says the same things, and dropping them turns a designed issue into a
 * column of unstyled text.
 */
const PRESENTATION = [
  'align',
  'alt',
  'bgcolor',
  'border',
  'cellpadding',
  'cellspacing',
  'class',
  'color',
  'colspan',
  'dir',
  'face',
  'height',
  'hspace',
  'id',
  'lang',
  'rowspan',
  'size',
  'span',
  'style',
  'title',
  'valign',
  'vspace',
  'width',
];

const ALLOWED_ATTRIBUTES: Record<string, string[]> = {
  '*': PRESENTATION,
  a: [...PRESENTATION, 'href', 'name', 'rel', 'target'],
  img: [...PRESENTATION, 'src', 'data-news-src'],
};

/**
 * A declaration that would fetch something, or that the CSS parser in an old
 * browser would run. `url()` is the one that matters: it is how a background
 * image loads, and a background image is a picture like any other.
 */
const FETCHING_DECLARATION = /url\s*\(|expression\s*\(|behaviou?r\s*:|-moz-binding/i;

/** Inline style, minus anything that would reach out for a file. */
function cleanStyle(style: string, images: boolean): string {
  return style
    .split(';')
    .filter((declaration) => {
      if (declaration.trim() === '') return false;
      if (!FETCHING_DECLARATION.test(declaration)) return true;
      // A url() is a picture: kept once the reader has asked for pictures,
      // dropped until then. The rest never comes back.
      return (
        images &&
        /url\s*\(/i.test(declaration) &&
        !/expression\s*\(|behaviou?r\s*:|-moz-binding/i.test(declaration)
      );
    })
    .map((declaration) => declaration.trim())
    .join('; ');
}

/**
 * Clean one newsletter.
 *
 * `images` is the reader's answer to "load the pictures?". The issue page
 * passes true unless the reader turned pictures off. While it is false, every
 * remote address a picture would be fetched from is moved out of `src` into
 * `data-news-src`, so nothing is requested from the sender. Turning it on puts
 * the same addresses back.
 */
export function cleanIssueHtml(html: string | null, images = false): CleanIssue {
  if (!html || html.trim() === '') return { html: '', blockedImages: 0, images: 0 };

  let blockedImages = 0;
  let pictureCount = 0;

  const clean = sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: ALLOWED_ATTRIBUTES,
    // No javascript:, no data:, no anything else. This is what makes a link
    // that looks ordinary either a real address or nothing at all.
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    allowedSchemesAppliedToAttributes: ['href', 'src', 'cite'],
    // A picture built into the message rather than fetched from somewhere is
    // still a picture, and is held back with the rest until they are asked
    // for. `data:` is allowed nowhere else.
    allowedSchemesByTag: { img: ['http', 'https', 'data'] },
    // Everything not allowed loses its tag and keeps its text, except these:
    // a script's text is the script, and a stylesheet's text is a stylesheet.
    nonTextTags: ['script', 'style', 'textarea', 'option', 'noscript', 'template'],
    // sanitize-html drops an unknown attribute, so an `onclick` never reaches
    // this. The transform is where `style`, `src` and `href` are narrowed
    // further.
    transformTags: {
      '*': (tagName, attribs) => {
        const next: Record<string, string> = { ...attribs };
        if (next.style !== undefined) {
          const style = cleanStyle(next.style, images);
          if (style === '') delete next.style;
          else next.style = style;
        }
        // The old way of putting a picture behind a table cell.
        delete next.background;
        return { tagName, attribs: next };
      },
      a: (tagName, attribs) => ({
        tagName,
        attribs: {
          ...attribs,
          // The frame opens links itself (#462), and this is what the browser
          // is told in case it ever gets to act on one directly.
          target: '_blank',
          rel: 'noopener noreferrer',
        },
      }),
      img: (tagName, attribs) => {
        const next: Record<string, string> = { ...attribs };
        // A set of sizes is a set of addresses, and there is no point holding
        // one back and fetching another.
        delete next.srcset;
        delete next.loading;
        if (next.src) pictureCount += 1;
        if (!images && next.src) {
          next['data-news-src'] = next.src;
          delete next.src;
          blockedImages += 1;
        }
        return { tagName, attribs: next };
      },
    },
  });

  return { html: clean, blockedImages, images: pictureCount };
}
