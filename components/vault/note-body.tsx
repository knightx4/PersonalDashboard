import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

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
 */
export function NoteBody({ markdown }: { markdown: string }) {
  return (
    <div className="vault-prose">
      <Markdown
        remarkPlugins={[remarkGfm]}
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
