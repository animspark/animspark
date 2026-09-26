/**
 * Parse explicit `@animspark/*` imports from shot / _shared sources.
 * This is the dependency source of truth (JSX regex is fallback only).
 */
import ts from 'typescript';
import type { ComponentImport } from './types';
import { animsparkJsxName } from './author-api';

export interface ParsedAnimSparkImport {
  /** npm package e.g. @animspark/stem */
  npmName: string;
  /** runtime package name e.g. animspark/stem */
  packageName: string;
  /** imported binding as written in source (Formula, imgproc, …) */
  importedName: string;
  /** registry component/function name (three, imgproc, …) */
  componentName: string;
  isTypeOnly: boolean;
}

const STEM_PKG_RE = /^@animspark\/([a-z0-9-]+)$/i;

/** `@animspark/stem` → `animspark/stem` */
export function npmNameToPackageName(npmName: string): string | null {
  const m = STEM_PKG_RE.exec(npmName.trim());
  return m ? `animspark/${m[1]}` : null;
}

function camelFromPascal(name: string): string {
  if (!name) return name;
  return name.charAt(0).toLowerCase() + name.slice(1);
}

/** Best-effort: JSX `Formula` → registry `formula`; keep `imgproc` as-is. */
export function importedNameToComponentName(importedName: string): string {
  if (!importedName) return importedName;
  if (importedName === importedName.toLowerCase()) return importedName;
  if (importedName[0] === importedName[0]?.toUpperCase()) return camelFromPascal(importedName);
  return importedName;
}

export function parseAnimSparkImportsFromSource(source: string, filename = 'shot.tsx'): ParsedAnimSparkImport[] {
  const sf = ts.createSourceFile(filename, source, ts.ScriptTarget.ES2020, true, ts.ScriptKind.TSX);
  const out: ParsedAnimSparkImport[] = [];
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt)) continue;
    if (!stmt.moduleSpecifier || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    const npmName = stmt.moduleSpecifier.text;
    const packageName = npmNameToPackageName(npmName);
    if (!packageName) continue;
    const clause = stmt.importClause;
    if (!clause) {
      out.push({
        npmName,
        packageName,
        importedName: '',
        componentName: '',
        isTypeOnly: false,
      });
      continue;
    }
    const isTypeOnly = !!clause.isTypeOnly;
    if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const el of clause.namedBindings.elements) {
        if (el.isTypeOnly) continue;
        const importedName = (el.propertyName ?? el.name).text;
        out.push({
          npmName,
          packageName,
          importedName,
          componentName: importedNameToComponentName(importedName),
          isTypeOnly,
        });
      }
    }
  }
  return out;
}

export function parseAnimSparkImports(sources: readonly string[]): ParsedAnimSparkImport[] {
  const seen = new Set<string>();
  const out: ParsedAnimSparkImport[] = [];
  sources.forEach((source, i) => {
    for (const item of parseAnimSparkImportsFromSource(source, `source-${i}.tsx`)) {
      const key = `${item.packageName}::${item.componentName || item.importedName}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
  });
  return out;
}

/**
 * Convert parsed imports to ComponentImport[].
 * Empty componentName (side-effect import) is dropped — pack needs concrete bindings.
 * When resolveKind is omitted, PascalCase imports default to component and camelCase to function.
 */
export function animsparkImportsToComponentImports(
  parsed: readonly ParsedAnimSparkImport[],
  resolveKind?: (packageName: string, componentName: string) => 'component' | 'function' | null,
): ComponentImport[] {
  const table = new Map<string, ComponentImport>();
  for (const p of parsed) {
    if (!p.componentName) continue;
    const kind =
      resolveKind?.(p.packageName, p.componentName)
      ?? (/^[A-Z]/.test(p.importedName) ? 'component' : 'function');
    if (!kind) continue;
    if (table.has(p.componentName)) continue;
    table.set(p.componentName, {
      boundName: p.componentName,
      kind,
      componentName: p.componentName,
      packageName: p.packageName,
    });
  }
  return [...table.values()];
}

/** Suggest the author import line for a binding. */
export function suggestAuthorImport(imp: ComponentImport): string {
  const npm = `@animspark/${imp.packageName.replace(/^animspark\//, '')}`;
  const name =
    imp.kind === 'function' ? imp.componentName : animsparkJsxName(imp.componentName);
  return `import { ${name} } from '${npm}';`;
}
