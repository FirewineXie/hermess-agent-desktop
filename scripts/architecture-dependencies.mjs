import { createRequire } from 'node:module'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'

const desktopRequire = createRequire(resolve(import.meta.dirname, '../apps/desktop/package.json'))
const ts = desktopRequire('typescript')

export function relativeImportViolations(source, file, projectSourceRoot) {
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  const violations = []

  const check = specifier => {
    if (!specifier.startsWith('.') && !isAbsolute(specifier)) return
    const target = resolve(dirname(file), specifier)
    const pathWithinProject = relative(projectSourceRoot, target)
    if (pathWithinProject === '..' || pathWithinProject.startsWith(`..${sep}`) || isAbsolute(pathWithinProject)) {
      violations.push(`relative import crosses project boundary: ${specifier}`)
    }
  }

  const visit = node => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      check(node.moduleSpecifier.text)
    }
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      const argument = node.moduleReference.expression
      if (argument && ts.isStringLiteral(argument)) check(argument.text)
      else violations.push('dynamic import path cannot be checked')
    }
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === 'require')) {
      const argument = node.arguments[0]
      if (argument && ts.isStringLiteral(argument)) check(argument.text)
      else violations.push('dynamic import path cannot be checked')
    }
    ts.forEachChild(node, visit)
  }
  visit(parsed)
  return violations
}
