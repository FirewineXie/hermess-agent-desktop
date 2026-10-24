import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const rules = [
  {
    directory: 'apps/frontend/src',
    forbidden: [/@tauri-apps\//, /@hermess\/desktop(?:\/|['"])/, /apps\/desktop\//, /\binvoke\s*[<(]/],
  },
  {
    directory: 'packages/contracts/src',
    forbidden: [/@tauri-apps\//, /@hermess\/(?:frontend|desktop)(?:\/|['"])/, /(?:from|require\()\s*['"]react(?:\/|['"])/],
  },
  {
    directory: 'apps/desktop/src',
    forbidden: [/@hermess\/frontend\//, /apps\/frontend\/src\//],
  },
]

const failures = []
for (const rule of rules) {
  const visit = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = join(directory, entry.name)
      if (entry.isDirectory()) visit(file)
      else if (/\.[cm]?[jt]sx?$/.test(entry.name)) {
        const source = readFileSync(file, 'utf8')
        for (const pattern of rule.forbidden) {
          if (pattern.test(source)) failures.push(`${relative(root, file)}: ${pattern}`)
        }
      }
    }
  }
  visit(resolve(root, rule.directory))
}

if (failures.length) {
  console.error(`Architecture boundary violations:\n${failures.join('\n')}`)
  process.exitCode = 1
} else {
  console.log('Architecture dependency boundaries verified')
}
