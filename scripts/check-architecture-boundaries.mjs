import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { relativeImportViolations } from './architecture-dependencies.mjs'

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
        for (const violation of relativeImportViolations(source, file, resolve(root, rule.directory))) {
          failures.push(`${relative(root, file)}: ${violation}`)
        }
        for (const pattern of rule.forbidden) {
          if (pattern.test(source)) failures.push(`${relative(root, file)}: ${pattern}`)
        }
      }
    }
  }
  visit(resolve(root, rule.directory))
}

const main = readFileSync(resolve(root, 'apps/desktop/src-tauri/src/main.rs'), 'utf8')
const adapter = readFileSync(resolve(root, 'apps/desktop/src/adapter/tauriDesktopApi.ts'), 'utf8')
const gateway = readFileSync(resolve(root, 'apps/desktop/src-tauri/src/gateway.rs'), 'utf8')
const registeredBlock = main.match(/generate_handler!\[([\s\S]*?)\]/)?.[1]
if (!registeredBlock) failures.push('apps/desktop/src-tauri/src/main.rs: command registration not found')
const registered = new Set([...((registeredBlock || '').matchAll(/[\w:]+::([a-z_]+)\s*,?/g))].map(match => match[1]))
const invoked = new Set([...adapter.matchAll(/\binvoke(?:<[^>]+>)?\s*\(\s*['"]([^'"]+)/g)].map(match => match[1]))
if (!registered.size || !invoked.size) failures.push('desktop command inventory is empty')
for (const name of invoked) if (!registered.has(name)) failures.push(`adapter invokes unregistered command: ${name}`)
for (const name of registered) if (!invoked.has(name)) failures.push(`registered command has no adapter capability: ${name}`)

const nativeCommandFiles = [
  'apps/desktop/src-tauri/src/runtime/mod.rs',
  'apps/desktop/src-tauri/src/runtime/chat.rs',
  'apps/desktop/src-tauri/src/runtime/config.rs',
  'apps/desktop/src-tauri/src/runtime/models.rs',
  'apps/desktop/src-tauri/src/runtime/tools.rs',
  'apps/desktop/src-tauri/src/diagnostics.rs',
]
const definedCommands = new Set()
for (const file of nativeCommandFiles) {
  const source = readFileSync(resolve(root, file), 'utf8')
  for (const marker of source.matchAll(/#\[tauri::command\]/g)) {
    const header = source.slice(marker.index, source.indexOf('{', marker.index))
    const name = header.match(/\bpub\s+(?:async\s+)?fn\s+(\w+)/)?.[1]
    if (!name) {
      failures.push(`${file}: command declaration could not be parsed`)
      continue
    }
    definedCommands.add(name)
    const returnType = header.split('->')[1]?.trim()
    if (returnType?.startsWith('Result<') && !returnType.endsWith('DesktopFailure>')) {
      failures.push(`${file}: ${name} must return DesktopFailure`)
    }
  }
}
for (const name of registered) if (!definedCommands.has(name)) failures.push(`registered command definition not found: ${name}`)

const emitted = new Set([...gateway.matchAll(/app\.emit\(\s*"([^"]+)"/g)].map(match => match[1]))
const listened = new Set([...adapter.matchAll(/listenPayload(?:<[^>]+>)?\(\s*['"]([^'"]+)/g)].map(match => match[1]))
if (!emitted.size || !listened.size) failures.push('desktop event inventory is empty')
for (const name of listened) if (!emitted.has(name)) failures.push(`adapter listens to event without native emitter: ${name}`)
for (const name of emitted) if (!listened.has(name)) failures.push(`native event has no adapter listener: ${name}`)

for (const feature of ['chat', 'config', 'models', 'tools']) {
  const source = readFileSync(resolve(root, `apps/desktop/src-tauri/src/runtime/${feature}.rs`), 'utf8')
  if (/\buse\s+super::\*\s*;/.test(source)) failures.push(`runtime/${feature}.rs: use explicit imports instead of super::*`)
}

if (failures.length) {
  console.error(`Architecture boundary violations:\n${failures.join('\n')}`)
  process.exitCode = 1
} else {
  console.log(`Architecture boundaries verified: ${registered.size} native commands and ${emitted.size} native events match the desktop adapter`)
}
