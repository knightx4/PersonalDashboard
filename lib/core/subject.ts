import 'server-only';

import { cache } from 'react';
import type { Crumb } from '@/components/shell/breadcrumb';
import type { Subject } from '@/components/shell/page-header';
import { requestAskDb } from '@/lib/ask/clients';
import { readRowsWith, refPath } from '@/lib/core/refs';

/**
 * The path for one row's page, read from the catalogue by refPath (plan
 * #1931.2), cached for the request so a page and its view can both ask.
 */
const pathFor = cache(async (ref: string): Promise<Crumb[]> => {
  try {
    return await refPath(ref, readRowsWith(requestAskDb()));
  } catch {
    // A failed read still knows where the row's table sits: workspace › section.
    return refPath(ref, async () => []);
  }
});

/**
 * What a page for one row passes PageHeader as its `subject`: the row's ref
 * and its path, workspace › section › the rows above › the row. A page below
 * the row's own (a subject's clips, a quiz being taken) names itself in
 * `below`, and the path runs on to it.
 */
export async function rowSubject(ref: string, ...below: Crumb[]): Promise<Subject> {
  return { ref, path: [...(await pathFor(ref)), ...below] };
}
