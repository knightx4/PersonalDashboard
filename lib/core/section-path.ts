import type { Crumb } from '@/components/shell/breadcrumb';
import type { Subject } from '@/components/shell/page-header';
import { MODULES } from '@/lib/modules';

/**
 * The first parts of every path (docs/ONE-INTERFACE-SPEC.md Part 2): the
 * workspace and the section of its nav. Kept apart from lib/core/refs.ts,
 * which reads the whole sources catalogue, so a list drawn by a client
 * component can name its section without carrying the catalogue with it.
 */

/** Where every path outside a workspace starts: the app's own home. */
export const HOME_CRUMB: Crumb = { label: 'Home', href: '/home' };

/** The workspace a page lives in, by its address; Home for the app's own pages. */
export function workspaceCrumb(href: string | null): Crumb {
  const path = href?.split(/[?#]/)[0] ?? '';
  const workspace = MODULES.find((m) => path === m.prefix || path.startsWith(`${m.prefix}/`));
  return workspace ? { label: workspace.label, href: workspace.home } : HOME_CRUMB;
}

/**
 * The path to a list page: workspace › section, as a list page draws it above
 * its heading (plan #1931.2), with the section's address and its tab's label.
 * A section at the workspace's own address is the workspace alone. A page
 * below the section that is not a catalogue row (a spec, a year, a YouTube
 * channel) names itself in `below`, and the path runs on to it.
 */
export function sectionPath(href: string, label: string, ...below: Crumb[]): Crumb[] {
  const workspace = workspaceCrumb(href);
  const section: Crumb[] = href !== workspace.href ? [{ label, href }] : [];
  return [workspace, ...section, ...below];
}

/** A list page's subject, for PageHeader: workspace › section, and anything below. */
export function sectionSubject(href: string, label: string, ...below: Crumb[]): Subject {
  return { ref: null, path: sectionPath(href, label, ...below) };
}
