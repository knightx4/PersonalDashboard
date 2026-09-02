/**
 * The parts of a note that are Obsidian's rather than markdown's.
 *
 * A general markdown renderer gets all of these wrong in the same way: it
 * passes them through as literal text, so a heavily linked vault renders as a
 * wall of double brackets. Handled here as one pass over the source before
 * rendering, because the alternative -- a remark plugin per syntax -- is a lot
 * of AST for what is really four rewrites.
 *
 * Pure, and deliberately not a full Obsidian implementation. What is here is
 * what shows up in a normal vault and would look broken untreated.
 */

/** A note the viewer can link to: path plus the name a wikilink would use. */
export type LinkTarget = { path: string; title: string };

export type WikiLink = {
  /** The note being referenced, as written. */
  target: string;
  /** The text to display -- an explicit alias, or the target. */
  label: string;
  /** A heading or block reference within the note, without the '#'. */
  anchor: string | null;
  /** True for `![[...]]`, which embeds rather than links. */
  embed: boolean;
};

/**
 * `[[Note]]`, `[[Note|shown]]`, `[[Note#Heading]]`, `![[Note]]`, `![[image.png]]`.
 *
 * The negative lookbehind on `!` is what separates a link from an embed, and
 * the two are handled very differently -- one is a link, the other is usually
 * an attachment this app deliberately does not have.
 */
const WIKILINK = /(!)?\[\[([^\]\n]+)\]\]/g;

/** Obsidian's own comment syntax: never rendered, in Obsidian or here. */
const COMMENT = /%%[\s\S]*?%%/g;

/**
 * `> [!note] Title` and friends.
 *
 * Horizontal whitespace only, never `\s`: `\s` matches a newline, so the title
 * capture ran on into the callout's first line of body text and swallowed it.
 */
const CALLOUT = /^([ \t]*>)[ \t]*\[!([A-Za-z-]+)\]([+-]?)[ \t]*(.*)$/gm;

/** Extensions that are attachments rather than notes. */
const NOTE_EXTENSION = /\.md$/i;
const HAS_EXTENSION = /\.[A-Za-z0-9]{1,8}$/;

export function parseWikiLink(raw: string, embed: boolean): WikiLink {
  const [beforeAlias, ...aliasParts] = raw.split('|');
  const alias = aliasParts.join('|').trim();

  const hashAt = beforeAlias.indexOf('#');
  const target = (hashAt === -1 ? beforeAlias : beforeAlias.slice(0, hashAt)).trim();
  const anchor = hashAt === -1 ? null : beforeAlias.slice(hashAt + 1).trim() || null;

  return {
    target,
    // What Obsidian displays: the alias if there is one, else the target with
    // its heading still attached, else -- for `[[#Heading]]`, which links
    // within the current note -- the heading alone.
    label: alias || (target && anchor ? `${target}#${anchor}` : target || anchor) || raw.trim(),
    anchor,
    embed,
  };
}

/**
 * Resolve a wikilink the way Obsidian does: by basename, not by path.
 *
 * People write `[[Rent]]`, not `[[Money/Housing/Rent.md]]`, and the same
 * basename can exist in two folders. Obsidian picks the closest match; this
 * picks the shortest path, which is the same answer in the common case and a
 * stable one in the rest. A full path is also accepted, because links pasted
 * from elsewhere use one.
 */
export function buildLinkIndex(targets: LinkTarget[]): Map<string, string> {
  const index = new Map<string, string>();

  const consider = (key: string, path: string) => {
    const existing = index.get(key);
    if (existing === undefined || path.length < existing.length) index.set(key, path);
  };

  for (const { path } of targets) {
    const withoutExtension = path.replace(NOTE_EXTENSION, '');
    const basename = withoutExtension.slice(withoutExtension.lastIndexOf('/') + 1);
    consider(basename.toLowerCase(), path);
    consider(withoutExtension.toLowerCase(), path);
    consider(path.toLowerCase(), path);
  }

  return index;
}

export function resolveWikiLink(link: WikiLink, index: Map<string, string>): string | null {
  if (!link.target) return null;
  return index.get(link.target.toLowerCase().replace(NOTE_EXTENSION, '')) ?? null;
}

/** Whether an embed points at something that is not a note. */
export function isAttachmentEmbed(link: WikiLink): boolean {
  if (!link.target) return false;
  if (NOTE_EXTENSION.test(link.target)) return false;
  return HAS_EXTENSION.test(link.target);
}

function slugifyAnchor(anchor: string): string {
  return anchor
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

/** Markdown-escape the characters that would change how a label renders. */
function escapeLabel(label: string): string {
  return label.replace(/([[\]()\\])/g, '\\$1');
}

export type RewriteOptions = {
  /** Basename and path index for the vault, from buildLinkIndex. */
  index: Map<string, string>;
  /** Where a resolved note lives, e.g. (path) => `/vault/n/${path}`. */
  hrefFor: (path: string) => string;
};

/**
 * Rewrite a note's source into plain markdown a general renderer can handle.
 *
 * Everything unresolvable degrades to text rather than to a dead link. A
 * broken link in a vault is normal -- notes get renamed, and a link written
 * for a note that does not exist yet is how Obsidian is meant to be used --
 * so it must not look like a rendering failure.
 */
export function toStandardMarkdown(source: string, options: RewriteOptions): string {
  const { index, hrefFor } = options;

  return source
    .replace(COMMENT, '')
    .replace(CALLOUT, (_match, quote: string, kind: string, _fold: string, title: string) => {
      // A callout becomes a blockquote with its type as a bold lead-in, which
      // is what it degrades to anywhere outside Obsidian anyway.
      const heading = title.trim() || kind.charAt(0).toUpperCase() + kind.slice(1).toLowerCase();
      return `${quote} **${heading}**`;
    })
    .replace(WIKILINK, (_match, bang: string | undefined, inner: string) => {
      const link = parseWikiLink(inner, bang === '!');

      if (link.embed && isAttachmentEmbed(link)) {
        // The bytes were never fetched -- by design, not by accident -- so say
        // that, rather than rendering a broken image.
        return `*(attachment not synced: ${link.target})*`;
      }

      const path = resolveWikiLink(link, index);
      if (!path) {
        // Same-note heading links have no target to resolve and are shown as
        // their heading; everything else that misses is plain text.
        return escapeLabel(link.label);
      }

      const href = link.anchor ? `${hrefFor(path)}#${slugifyAnchor(link.anchor)}` : hrefFor(path);

      // A note embed renders as a link in v1. Transclusion is a recursion
      // problem -- a note embedding itself, or two embedding each other -- and
      // a viewer does not need to solve it to be useful.
      return `[${escapeLabel(link.label)}](${href})`;
    });
}

/** Every wikilink in a note, for building a backlink list later. */
export function wikiLinksIn(source: string): WikiLink[] {
  const links: WikiLink[] = [];
  for (const match of source.replace(COMMENT, '').matchAll(WIKILINK)) {
    links.push(parseWikiLink(match[2], match[1] === '!'));
  }
  return links;
}
