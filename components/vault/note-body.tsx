import { FileText } from 'lucide-react';
import rehypeKatex from 'rehype-katex';
import remarkMath from 'remark-math';

import { cardVariants } from '@/components/ui/card';
import { Markdown } from '@/components/ui/markdown';
import { cn } from '@/lib/cn';
import {
  attachmentHref,
  readSize,
  viewAttachment,
  type AttachmentEntry,
  type AttachmentIndex,
  type AttachmentView,
} from '@/lib/vault/markdown/attachments';
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
 * The rendering is the shared one (components/ui/markdown.tsx), with maths and
 * vault attachments added. Raw HTML is not rendered there, and that is the
 * sanitizer, which matters more than it looks here, because Obsidian web-clipper notes
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
 *
 * The note sits on a card rather than straight on the page (note 9c17324b):
 * the page ground is the room, and the note is the object in it, the same
 * surface the properties above it already sit on. Code blocks and tables keep
 * their sunken fill, which reads against the card as it did against the page.
 */
export function NoteBody({
  markdown,
  notePath = '',
  attachments,
  hrefForAttachment = attachmentHref,
}: {
  markdown: string;
  /** The note's vault path, which a relative embed is resolved against. */
  notePath?: string;
  /** The vault's attachment rows; without them every embed shows as missing. */
  attachments?: AttachmentIndex;
  /** Where a copied file is fetched from; the preview gallery points it at fixtures. */
  hrefForAttachment?: (entry: AttachmentEntry) => string;
}) {
  return (
    <Markdown
      markdown={markdown}
      className={cn(cardVariants({ padding: 'standard' }), 'vault-prose')}
      remarkPlugins={[remarkMath, remarkObsidianMath]}
      rehypePlugins={[[rehypeKatex, KATEX]]}
      image={({ src, alt }) => {
        const view = viewAttachment(
          src,
          alt,
          notePath,
          attachments ?? EMPTY_INDEX,
          hrefForAttachment,
        );
        if (view) return <Attachment view={view} alt={alt} />;
        // An image on somebody else's host. Rendering it would leak a page
        // view to whoever owns that host every time the note is opened, so it
        // stays a label.
        return <em className="text-ink-muted">{alt ? `(image: ${alt})` : '(image)'}</em>;
      }}
    />
  );
}

const EMPTY_INDEX: AttachmentIndex = { byPath: new Map(), byName: new Map() };

/** What each state that is not a file says, after the file's name. */
const UNAVAILABLE: Record<Exclude<AttachmentView['state'], 'ready'>, string> = {
  waiting: 'not copied from the vault yet',
  'too-large': 'over 50 MB, so not kept',
  'not-kept': 'this type of file is not kept',
  missing: 'not in the vault',
};

/**
 * One embedded file (plan #1302). Every element here is phrasing content,
 * because an embed sits inside a paragraph and a block element there would
 * make the browser close the paragraph around it. None of it needs
 * JavaScript: the image, the PDF link and the audio controls are the
 * browser's own.
 *
 * The src is the /vault/attachment route, which signs a link to the private
 * copy on each request; nothing signed is written into the page.
 */
function Attachment({ view, alt }: { view: AttachmentView; alt: string }) {
  if (view.state !== 'ready') {
    return (
      <span className="text-ui text-ink-muted">
        {view.name}: {UNAVAILABLE[view.state]}
      </span>
    );
  }

  if (view.kind === 'image') {
    const shown = readSize(alt).alt;
    return (
      // eslint-disable-next-line @next/next/no-img-element -- a signed, private file behind a redirect; the image optimiser cannot fetch it on the viewer's session
      <img
        src={view.href}
        alt={shown && shown !== view.name ? shown : view.name}
        loading="lazy"
        width={view.width ?? undefined}
        height={view.height ?? undefined}
        className="vault-attachment-image"
      />
    );
  }

  if (view.kind === 'pdf') {
    return (
      <a href={view.href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5">
        <FileText className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />
        {view.name}
      </a>
    );
  }

  return (
    <span className="vault-attachment-audio">
      <audio controls preload="none" src={view.href} aria-label={view.name} />
      <span className="text-ui text-ink-muted">{view.name}</span>
    </span>
  );
}
