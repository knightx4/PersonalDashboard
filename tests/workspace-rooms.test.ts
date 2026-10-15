/**
 * Every workspace's column and dock begin with the same two rooms, Now and
 * Inbox, and only the Inbox carries a badge (docs/ONE-INTERFACE-SPEC.md, R1
 * and R2; plan #1937.6). The dock shows the first three sections beside the
 * switcher and More, so these two fix its first two slots in every workspace.
 *
 * The section lists are built inside server layouts that read the database,
 * so this reads the layouts' source instead: every object literal with both
 * an `href` and a `label` is a section, in the order it is written. A layout
 * that builds its bar with `tabsFor` is read through lib/shell/tabs.ts.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { MODULES } from '@/lib/modules';
import { WORKSPACE_TABS, type TabWorkspace } from '@/lib/shell/tabs';

const ROOT = join(__dirname, '..');

/** Each workspace's layout, the file that names its sections. */
const LAYOUTS: Record<string, string> = {
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
 */
const NO_INBOX_YET = new Set(['you']);

type Section = { href: string; label: string; badge: boolean };

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

function read(file: string): { sections: Section[]; settings: boolean } {
  const source = ts.createSourceFile(
    file,
    readFileSync(join(ROOT, file), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const sections: Section[] = [];
  let settings = false;
  // A layout that builds its bar from lib/shell/tabs.ts (plan #2208.2) names
  // the workspace in `tabsFor('<id>', …)` and its badges by href, as the
  // string keys of the object it hands `withBadges`.
  let listed: TabWorkspace | null = null;
  const badged = new Set<string>();
  const visit = (node: ts.Node) => {
    if (ts.isObjectLiteralExpression(node)) {
      const href = stringProp(node, 'href');
      const label = stringProp(node, 'label');
      if (href !== null && label !== null)
        sections.push({ href, label, badge: hasProp(node, 'badge') });
      if (stringProp(node, 'settingsHref') !== null) settings = true;
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const [first, second] = node.arguments;
      if (node.expression.text === 'tabsFor' && first && ts.isStringLiteral(first)) {
        listed = first.text as TabWorkspace;
      }
      if (node.expression.text === 'withBadges' && second && ts.isObjectLiteralExpression(second)) {
        for (const prop of second.properties) {
          if (ts.isPropertyAssignment(prop) && ts.isStringLiteral(prop.name))
            badged.add(prop.name.text);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (listed !== null) {
    const tabs = WORKSPACE_TABS[listed as TabWorkspace].map(({ href, label }) => ({
      href,
      label,
      badge: badged.has(href),
    }));
    return { sections: [...tabs, ...sections], settings };
  }
  return { sections, settings };
}

describe('the rooms every workspace opens with', () => {
  it('has a layout listed for every workspace', () => {
    const workspaces = MODULES.map((m) => m.id).filter((id) => !NO_INBOX_YET.has(id));
    expect(workspaces.sort()).toEqual(Object.keys(LAYOUTS).sort());
  });

  for (const [workspace, file] of Object.entries(LAYOUTS)) {
    describe(workspace, () => {
      const { sections, settings } = read(file);

      it('starts with Now, then Inbox', () => {
        expect(sections.slice(0, 2).map((s) => s.label)).toEqual(['Now', 'Inbox']);
      });

      it("keeps the Inbox at the workspace's own /inbox", () => {
        expect(sections[1]?.href).toMatch(/\/inbox$/);
      });

      it('carries a badge on the Inbox and nowhere else', () => {
        const badged = sections.filter((s, i) => s.badge && i !== 1).map((s) => s.label);
        expect(badged).toEqual([]);
      });

      it('sets its settings link', () => {
        expect(settings).toBe(true);
      });
    });
  }
});
