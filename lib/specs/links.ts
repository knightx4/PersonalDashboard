import { SPECS } from '@/lib/specs/registry';

/**
 * Where a link written inside a specification should point on these pages.
 *
 * The documents link to each other the way files do -- `[LEARN-GRAPH-SPEC.md]
 * (LEARN-GRAPH-SPEC.md)` -- which is correct in the repository and broken in a
 * browser. That href resolves against `/dev/specs/learn-map` and lands on
 * `/dev/specs/LEARN-GRAPH-SPEC.md`, which is a slug no spec has, so the page
 * 404s. Every spec in `docs/` cross-references its neighbours this way, so the
 * fix belongs to the link rather than to the one document somebody clicked from.
 *
 * Three outcomes, and the third is the one worth stating. A document with a page
 * is rewritten to that page. An external link, an in-page anchor and an absolute
 * app path are left as they are. A link to a file in the repository that has no
 * page -- `SETUP.md`, a trial write-up under `trials/` -- returns null, and the
 * caller renders the text without a link, because there is nothing to open and a
 * link that 404s is a worse answer than no link.
 *
 * A `#fragment` survives the rewrite. `anchorFor` uses GitHub's convention, so a
 * fragment written against the file's headings is the anchor the section card
 * already carries.
 */
export function specLinkHref(href: string | undefined | null): string | null {
  if (!href) return null;

  const trimmed = href.trim();
  if (trimmed === '') return null;

  // External, in-page, or already an app route: not ours to resolve.
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#|\/)/i.test(trimmed)) return trimmed;

  const hash = trimmed.indexOf('#');
  const fragment = hash === -1 ? '' : trimmed.slice(hash);
  const filePath = (hash === -1 ? trimmed : trimmed.slice(0, hash)).replace(/^\.\//, '');

  if (filePath === '') return fragment || null;

  // `docs/` is how a link from elsewhere in the repository names the same file.
  const normalized = filePath.replace(/^docs\//i, '').toLowerCase();
  const spec = SPECS.find((candidate) => candidate.file.toLowerCase() === normalized);

  return spec ? `/dev/specs/${spec.slug}${fragment}` : null;
}
