import Markdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';

import { remarkObsidianMath } from '@/lib/vault/markdown/math';

import 'katex/dist/katex.min.css';

/**
 * How KaTeX is allowed to behave on somebody else's markup.
 *
 * `trust` stays off, which is what keeps `\href` and `\includegraphics` from
 * being a way back in for a clipped page -- the same reason raw HTML is off
 * below. A formula KaTeX cannot parse is drawn as its own source in red
 * rather than thrown, because one malformed expression must not cost the
 * whole note. `strict: 'ignore'` is about the log rather than the page:
 * Obsidian notes use Unicode in maths freely and each one is a warning nobody
 * reads.
 */
const KATEX = {
  trust: false,
  throwOnError: false,
  strict: 'ignore',
  // KaTeX writes this into the style attribute of the source it falls back
  // to, so it has to be the token rather than a class the stylesheet could
  // set: an inline colour would win over the stylesheet in all four themes.
  errorColor: 'var(--c-danger)',
} as const;

/**
 * A note, rendered.
 *
 * `rehype-raw` is deliberately absent, and its absence is the sanitizer. With
 * raw HTML disabled, react-markdown will not render embedded HTML at all --
 * which matters more than it looks here, because Obsidian web-clipper notes
 * routinely carry whatever markup the page they clipped contained. "It is only
 * my own data" is not a defence when the data came from the open web, and this
 * is the one place in the app where a note's author and its content have
 * different provenance.
 *
 * The source has already been through toStandardMarkdown(), so wikilinks are
 * ordinary links by the time they arrive.
 *
 * Maths is written the way Obsidian writes it, `$x$` inline and `$$x$$` on a
 * line of its own, and rendered by KaTeX on the server -- nothing of it is
 * shipped to the browser but the stylesheet. `remarkObsidianMath` is what
 * keeps "$20 or $30" two prices rather than one expression; remark-math on
 * its own reads any pair of dollar signs as a formula.
 */
export function NoteBody({ markdown }: { markdown: string }) {
  return (
    <div className="vault-prose">
      <Markdown
        remarkPlugins={[remarkGfm, remarkMath, remarkObsidianMath]}
        rehypePlugins={[[rehypeKatex, KATEX]]}
        components={{
          a({ href, children, ...props }) {
            const external = /^https?:\/\//i.test(href ?? '');
            return (
              <a
                href={href}
                {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                {...props}
              >
                {children}
              </a>
            );
          },
          img({ alt }) {
            // Attachments are never synced, so an <img> here can only point
            // somewhere off-site. Rendering it would leak a page view to
            // whoever owns that host every time the note is opened.
            return <em className="text-ink-muted">{alt ? `(image: ${alt})` : '(image)'}</em>;
          },
        }}
      >
        {markdown}
      </Markdown>
    </div>
  );
}
