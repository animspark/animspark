/** Read literal MG durations for the asset list; evaluation measures computed durations. */
import ts from 'typescript';

export function mgDurationSpecOf(source: string): number | null {
  const file = ts.createSourceFile('mg.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const values = new Map<string, ts.Expression>();
  let duration: ts.Expression | undefined;
  let legacy: ts.Expression | undefined;
  let component: string | undefined;
  for (const node of file.statements) {
    if (ts.isExportAssignment(node) && ts.isIdentifier(node.expression)) component = node.expression.text;
    if (ts.isFunctionDeclaration(node) && node.name
      && node.modifiers?.some(mod => mod.kind === ts.SyntaxKind.DefaultKeyword)) component = node.name.text;
    if (!ts.isVariableStatement(node)) continue;
    for (const declaration of node.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
      values.set(declaration.name.text, declaration.initializer);
      if (declaration.name.text === 'durationSec'
        && node.modifiers?.some(mod => mod.kind === ts.SyntaxKind.ExportKeyword)) duration = declaration.initializer;
    }
  }
  for (const node of file.statements) {
    if (ts.isExportDeclaration(node) && !node.moduleSpecifier && node.exportClause && ts.isNamedExports(node.exportClause)) {
      for (const item of node.exportClause.elements) {
        if (item.name.text === 'durationSec') duration = values.get((item.propertyName ?? item.name).text);
        if (item.name.text === 'default') component = (item.propertyName ?? item.name).text;
      }
    }
  }
  for (const node of file.statements) {
    if (!ts.isExpressionStatement(node) || !ts.isBinaryExpression(node.expression)) continue;
    const assignment = node.expression;
    if (assignment.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && ts.isPropertyAccessExpression(assignment.left) && assignment.left.name.text === 'duration'
      && ts.isIdentifier(assignment.left.expression)
      && (!component || assignment.left.expression.text === component)) legacy = assignment.right;
  }
  let value = legacy ?? duration;
  while (value && (ts.isParenthesizedExpression(value) || ts.isAsExpression(value) || ts.isSatisfiesExpression(value))) value = value.expression;
  const seconds = value && ts.isNumericLiteral(value) ? Number(value.text)
    : value && ts.isPrefixUnaryExpression(value) && value.operator === ts.SyntaxKind.PlusToken && ts.isNumericLiteral(value.operand)
      ? Number(value.operand.text) : null;
  return seconds != null && Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}
