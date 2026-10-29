/**
 * Every workspace's column and dock begin with the same two rooms, Now and
 * Inbox, and only the Inbox carries a badge (docs/ONE-INTERFACE-SPEC.md, R1
 * and R2; plan #1937.6). The dock shows the first three sections beside the
 * switcher and More, so these two fix its first two slots in every workspace.
 *
 * The tabs and their order come from the one list in lib/shell/tabs.ts
 * (plan #2208). The badges and the settings link are still each layout's, and
 * its layout reads the database, so those are read from the layout's source:
 * a `badge` on an object literal with an `href`, or an address given a count
 * through `withBadges(…, { '<href>': … })`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { MODULES } from '@/lib/modules';
import { WORKSPACE_TABS, type TabWorkspace } from '@/lib/shell/tabs';

const ROOT = join(__dirname, '..');

/** Each workspace's layout, the file that names its sections. */
const LAYOUTS: Partial<Record<TabWorkspace, string>> = {
  shopping: 'app/shopping/layout.tsx',
  jobs: 'app/jobs/(app)/layout.tsx',
  todo: 'app/todo/layout.tsx',
  vault: 'app/vault/layout.tsx',
  learn: 'app/learn/layout.tsx',
  news: 'app/news/layout.tsx',
  goals: 'app/goals/layout.tsx',
  dev: 'app/dev/layout.tsx',
};

/**
 * Workspaces that have no Inbox page yet. You (plan #1991) arrived after the
 * Inboxes were built (plan #1937.5); take it off this list when it has one.
 * Finances (plan #2593) is the same: nothing in it lands in an inbox yet.
 */
const NO_INBOX_YET = new Set(['you', 'finances']);

function stringProp(node: ts.ObjectLiteralExpression, name: string): string | null {
  for (const prop of node.properties) {
    if (
      ts.isPropertyAssignment(prop) &&
      ts.isIdentifier(prop.name) &&
      prop.name.text === name &&
      ts.isStringLiteral(prop.initializer)
    ) {
      return prop.initializer.text;
    }
  }
  return null;
}

function hasProp(node: ts.ObjectLiteralExpression, name: string): boolean {
  return node.properties.some(
    (prop) =>
      (ts.isPropertyAssignment(prop) || ts.isShorthandPropertyAssignment(prop)) &&
      ts.isIdentifier(prop.name) &&
      prop.name.text === name,
  );
}

function read(file: string): { badged: string[]; settings: boolean } {
  const source = ts.createSourceFile(
    file,
    readFileSync(join(ROOT, file), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const badged: string[] = [];
  let settings = false;
  const visit = (node: ts.Node) => {
    if (ts.isObjectLiteralExpression(node)) {
      const href = stringProp(node, 'href');
      if (href !== null && hasProp(node, 'badge')) badged.push(href);
      if (stringProp(node, 'settingsHref') !== null) settings = true;
    }
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'withBadges'
    ) {
      const counts = node.arguments[1];
      if (counts && ts.isObjectLiteralExpression(counts)) {
        for (const prop of counts.properties) {
          if (prop.name && ts.isStringLiteral(prop.name)) badged.push(prop.name.text);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { badged, settings };
}

describe('the rooms every workspace opens with', () => {
  it('has a layout listed for every workspace', () => {
    const workspaces = MODULES.map((m) => m.id).filter((id) => !NO_INBOX_YET.has(id));
    expect(workspaces.sort()).toEqual(Object.keys(LAYOUTS).sort());
  });

  for (const [workspace, file] of Object.entries(LAYOUTS) as [TabWorkspace, string][]) {
    describe(workspace, () => {
      const sections = WORKSPACE_TABS[workspace];
      const { badged, settings } = read(file);

      it('starts with Now, then Inbox', () => {
        expect(sections.slice(0, 2).map((s) => s.label)).toEqual(['Now', 'Inbox']);
      });

      it("keeps the Inbox at the workspace's own /inbox", () => {
        expect(sections[1]?.href).toMatch(/\/inbox$/);
      });

      it('carries a badge on the Inbox and nowhere else', () => {
        expect(badged.filter((href) => href !== sections[1]?.href)).toEqual([]);
      });

      it('sets its settings link', () => {
        expect(settings).toBe(true);
      });
    });
  }
});
