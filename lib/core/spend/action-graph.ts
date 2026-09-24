import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import ts from 'typescript';

/**
 * Which spend operations a function can record, read from the source.
 *
 * For tests only: it reads files and parses them with the TypeScript
 * compiler, which has no place in a page. The cost hints name the operations a
 * press will record (lib/core/spend/paid-actions.ts), and this is what checks
 * that they do, by following a server action through every function it calls
 * until it reaches the ledger writers.
 *
 * What counts as recording an operation:
 * - an argument of a call to a `record…Spend` function: an operation name as a
 *   string, a module constant holding one, or an object (or constant object)
 *   whose `operation` is one;
 * - a reference to a module constant whose name ends in `OPERATION` and whose
 *   value is an operation name, which is how the catalogue embedding writes
 *   its rows through its own connection.
 *
 * Calls are followed through functions declared in the same file and through
 * named imports from `@/…` and relative paths. Packages are not followed, nor
 * are method calls on objects. A `record…Spend` call whose operation cannot be
 * read is reported rather than skipped, so a hint cannot pass by accident.
 */

const ROOT = join(__dirname, '..', '..', '..');

type Parsed = {
  source: ts.SourceFile;
  /** Functions declared at the top level, by name. */
  functions: Map<string, ts.Node>;
  /** Named imports: local name to the file and the name it has there. */
  imports: Map<string, { file: string; name: string }>;
  /** Top-level constants, by name, with their initialisers. */
  constants: Map<string, ts.Expression>;
};

const parsedFiles = new Map<string, Parsed | null>();

function resolveModule(specifier: string, fromFile: string): string | null {
  let base: string;
  if (specifier.startsWith('@/')) base = join(ROOT, specifier.slice(2));
  else if (specifier.startsWith('.')) base = join(dirname(fromFile), specifier);
  else return null;
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
  ]) {
    if (/\.tsx?$/.test(candidate) && existsSync(candidate)) return candidate;
  }
  return null;
}

function parse(file: string): Parsed | null {
  if (parsedFiles.has(file)) return parsedFiles.get(file) ?? null;
  if (!existsSync(file)) {
    parsedFiles.set(file, null);
    return null;
  }
  const source = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const functions = new Map<string, ts.Node>();
  const imports = new Map<string, { file: string; name: string }>();
  const constants = new Map<string, ts.Expression>();

  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      functions.set(statement.name.text, statement);
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
        const init = declaration.initializer;
        if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
          functions.set(declaration.name.text, init);
        } else {
          constants.set(declaration.name.text, init);
        }
      }
    } else if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.importClause?.namedBindings &&
      ts.isNamedImports(statement.importClause.namedBindings) &&
      !statement.importClause.isTypeOnly
    ) {
      const target = resolveModule(statement.moduleSpecifier.text, file);
      if (!target) continue;
      for (const element of statement.importClause.namedBindings.elements) {
        if (element.isTypeOnly) continue;
        imports.set(element.name.text, {
          file: target,
          name: (element.propertyName ?? element.name).text,
        });
      }
    }
  }

  const parsed = { source, functions, imports, constants };
  parsedFiles.set(file, parsed);
  return parsed;
}

function unwrap(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isParenthesizedExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

export type ActionOperations = {
  /** Every operation name the function can record, background ones included. */
  operations: Set<string>;
  /** `record…Spend` calls whose operation could not be read, as file:line. */
  unread: string[];
};

/**
 * The operations `name` in `file` can record, following what it calls.
 *
 * `known` is the set of every operation name, so a string that merely
 * happens to sit in a spend call is not mistaken for one.
 */
export function operationsReachedBy(
  file: string,
  name: string,
  known: ReadonlySet<string>,
): ActionOperations {
  const result: ActionOperations = { operations: new Set(), unread: [] };
  const visited = new Set<string>();

  function stringFrom(parsed: Parsed, expression: ts.Expression): string | null {
    const node = unwrap(expression);
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      return known.has(node.text) ? node.text : null;
    }
    if (ts.isIdentifier(node)) {
      const constant = parsed.constants.get(node.text);
      if (constant) return stringFrom(parsed, constant);
      const imported = parsed.imports.get(node.text);
      if (imported) {
        const other = parse(imported.file);
        const value = other?.constants.get(imported.name);
        if (other && value) return stringFrom(other, value);
      }
    }
    return null;
  }

  function operationFrom(parsed: Parsed, expression: ts.Expression): string | null {
    const direct = stringFrom(parsed, expression);
    if (direct) return direct;
    let node = unwrap(expression);
    let owner = parsed;
    if (ts.isIdentifier(node)) {
      const constant = parsed.constants.get(node.text);
      const imported = parsed.imports.get(node.text);
      if (constant) node = unwrap(constant);
      else if (imported) {
        const other = parse(imported.file);
        const value = other?.constants.get(imported.name);
        if (!other || !value) return null;
        owner = other;
        node = unwrap(value);
      }
    }
    if (!ts.isObjectLiteralExpression(node)) return null;
    for (const property of node.properties) {
      if (
        ts.isPropertyAssignment(property) &&
        ts.isIdentifier(property.name) &&
        property.name.text === 'operation'
      ) {
        return stringFrom(owner, property.initializer);
      }
    }
    return null;
  }

  function follow(parsed: Parsed, identifier: string): void {
    if (parsed.functions.has(identifier)) {
      visit(parsed.source.fileName, identifier);
      return;
    }
    const imported = parsed.imports.get(identifier);
    if (imported) visit(imported.file, imported.name);
  }

  function visit(file: string, fn: string): void {
    const key = `${file}#${fn}`;
    if (visited.has(key)) return;
    visited.add(key);
    const parsed = parse(file);
    const declaration = parsed?.functions.get(fn);
    if (!parsed || !declaration) return;

    const walk = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const callee = node.expression;
        if (ts.isIdentifier(callee) && /^record\w*Spend\w*$/.test(callee.text)) {
          const found = node.arguments
            .map((argument) => operationFrom(parsed, argument))
            .filter((value): value is string => value !== null);
          if (found.length > 0) {
            for (const operation of found) result.operations.add(operation);
          } else {
            const { line } = parsed.source.getLineAndCharacterOfPosition(node.getStart());
            result.unread.push(`${relative(ROOT, file)}:${line + 1}`);
          }
          // Not followed: a writer records what it is handed, and its own
          // insert names the operation only as a parameter.
        } else if (ts.isIdentifier(callee)) {
          follow(parsed, callee.text);
        }
        for (const argument of node.arguments) {
          if (ts.isIdentifier(argument)) follow(parsed, argument.text);
        }
      } else if (ts.isIdentifier(node) && /OPERATION$/.test(node.text)) {
        const value = stringFrom(parsed, node);
        if (value) result.operations.add(value);
      }
      ts.forEachChild(node, walk);
    };
    walk(declaration);
  }

  visit(file, name);
  return result;
}

/** The exported functions of a server action file or route handler, by name. */
export function exportedFunctions(file: string): string[] {
  const parsed = parse(file);
  if (!parsed) return [];
  const names: string[] = [];
  for (const statement of parsed.source.statements) {
    const exported = ts
      .getModifiers(statement as ts.HasModifiers)
      ?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
    if (!exported) continue;
    if (ts.isFunctionDeclaration(statement) && statement.name) names.push(statement.name.text);
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && parsed.functions.has(declaration.name.text)) {
          names.push(declaration.name.text);
        }
      }
    }
  }
  return names;
}

const isUseServer = (statement: ts.Statement) =>
  ts.isExpressionStatement(statement) &&
  ts.isStringLiteral(statement.expression) &&
  statement.expression.text === 'use server';

/**
 * Where a file declares server actions: `'file'` when it opens with
 * `'use server'`, so every export is one; `'inline'` when a function inside
 * it does, which the walk does not reach; null when it declares none.
 */
export function serverDirective(file: string): 'file' | 'inline' | null {
  const parsed = parse(file);
  if (!parsed) return null;
  for (const statement of parsed.source.statements) {
    if (isUseServer(statement)) return 'file';
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) break;
  }
  let inline = false;
  const walk = (node: ts.Node): void => {
    if (inline) return;
    if (ts.isBlock(node) && node.statements.some(isUseServer)) inline = true;
    else ts.forEachChild(node, walk);
  };
  walk(parsed.source);
  return inline ? 'inline' : null;
}

/** A file's named imports from `@/…` and relative paths: local name to source. */
export function namedImports(file: string): Map<string, { file: string; name: string }> {
  return parse(file)?.imports ?? new Map();
}

export const REPO_ROOT = ROOT;
