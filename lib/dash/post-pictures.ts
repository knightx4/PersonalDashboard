import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { devAccess } from '@/lib/ask/dev';
import { optionalString, type AskContext, type AskRow, type AskToolResult } from '@/lib/ask/db';
import { MODULES, isModuleId, type ModuleId } from '@/lib/modules';

/**
 * The pictures Dash may attach to an X post draft (plan #2384.2, feature #2384).
 *
 * A posts run photographs a gallery surface and commits the PNG as
 * `public/posts/<YYYY-MM-DD>-<surface id>.png` (.claude/skills/posts/SKILL.md).
 * The listing reads that folder on every call, so a picture added later is
 * offered without a change here, and gives each file the workspace its surface
 * id starts with ("dev-plan-tree" shows Dev) and a label made from the rest.
 * These files are the only images a draft can take from Dash: the path in
 * `path` is the value a draft's `image_paths` holds for a gallery picture.
 */

/** The folder the pictures are kept in, from the project root. */
export const POST_PICTURES_DIR = 'public/posts';

/** The site path a picture is served from, and what a draft keeps. */
export const POST_PICTURES_URL = '/posts';

/** The table a picture is cited under; its ref is the site path. */
export const POST_PICTURE_TABLE = 'docs.post_pictures';

/** One picture Dash may attach. */
export type PostPicture = {
  /** The file name: `2026-10-09-vault-note.png`. */
  file: string;
  /** The site path, as a draft's `image_paths` holds it: `/posts/2026-10-09-vault-note.png`. */
  path: string;
  /** The day it was photographed, `YYYY-MM-DD`. */
  date: string;
  /** The gallery surface id: `vault-note`. */
  surface: string;
  /** The workspace the surface shows, or null when its id does not start with one. */
  workspace: ModuleId | null;
  /** A short label for choosing: "Vault: note". */
  label: string;
};

const FILE = /^(\d{4}-\d{2}-\d{2})-([a-z0-9][a-z0-9-]*)\.png$/;

/** "plan-tree" as "plan tree". */
function words(rest: string): string {
  return rest.replace(/-/g, ' ');
}

/** The picture a file name describes, or null for a file that is not one. */
export function pictureOf(file: string): PostPicture | null {
  const match = FILE.exec(file);
  if (!match) return null;
  const [, date, surface] = match;
  const head = surface.split('-')[0];
  const workspace = isModuleId(head) ? head : null;
  let label: string;
  if (workspace) {
    const name = MODULES.find((m) => m.id === workspace)?.label ?? workspace;
    const rest = surface.slice(head.length + 1);
    label = rest ? `${name}: ${words(rest)}` : name;
  } else {
    label = words(surface).replace(/^./, (c) => c.toUpperCase());
  }
  return { file, path: `${POST_PICTURES_URL}/${file}`, date, surface, workspace, label };
}

/**
 * Every picture in public/posts/, newest day first and then by surface id.
 * A missing folder is no pictures; anything in it that is not named as a
 * picture is left out.
 */
export async function listPostPictures(dir: string = path.join(process.cwd(), POST_PICTURES_DIR)): Promise<PostPicture[]> {
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return [];
  }
  return files
    .map(pictureOf)
    .filter((p): p is PostPicture => p !== null)
    .sort((a, b) => b.date.localeCompare(a.date) || a.surface.localeCompare(b.surface));
}

function rowOf(p: PostPicture): AskRow {
  return {
    table: POST_PICTURE_TABLE,
    ref: p.path,
    title: p.label,
    href: p.path,
    detail: { path: p.path, date: p.date, surface: p.surface, workspace: p.workspace, label: p.label },
  };
}

/**
 * The `post_pictures` lookup: the gallery pictures a post draft may carry,
 * each with its site path, day, surface, workspace and label. Optionally only
 * those of one workspace. Only for the owner of the app, with Dev on, since
 * the Posts tab is Dev's.
 */
export async function postPicturesLookup(
  ctx: AskContext,
  input: Record<string, unknown>,
  dir?: string,
): Promise<AskToolResult> {
  const access = await devAccess(ctx);
  if (!access.ok) return access;

  const workspace = optionalString(input, 'workspace')?.toLowerCase();
  const all = await listPostPictures(dir);
  const shown = workspace ? all.filter((p) => p.workspace === workspace) : all;
  if (shown.length === 0) {
    return {
      ok: true,
      rows: [],
      note: workspace
        ? `No picture in the gallery shows ${workspace}. A draft about it goes without one.`
        : 'There are no gallery pictures yet, so a draft goes without one.',
    };
  }
  return {
    ok: true,
    rows: shown.map(rowOf),
    note: "Pass a picture's path as the draft's image; these are the only images a draft can take from you.",
  };
}
