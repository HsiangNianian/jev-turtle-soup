import ts from 'typescript'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const roots = ['packages/client-core/src', 'mobile/app', 'mobile/src']
const forbidden = /^(?:openai|@typesafe-ai\/|wrangler|node:)/
let count = 0
function visit(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      visit(file)
      continue
    }
    if (!/\.[tj]sx?$/.test(file)) continue
    count++
    const source = ts.createSourceFile(
      file,
      readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    )
    function check(node) {
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      ) {
        const specifier = node.moduleSpecifier.text
        if (forbidden.test(specifier))
          throw new Error(`${file} imports server dependency ${specifier}`)
        if (specifier.startsWith('.')) {
          const relative = path
            .relative(root, path.resolve(path.dirname(file), specifier))
            .replaceAll('\\', '/')
          if (/^(shared|worker|server|src)\//.test(relative))
            throw new Error(`${file} crosses the client boundary: ${specifier}`)
        }
      }
      ts.forEachChild(node, check)
    }
    check(source)
  }
}
for (const directory of roots)
  if (existsSync(path.join(root, directory))) visit(path.join(root, directory))
console.log(`Checked ${count} client modules: no server imports`)
