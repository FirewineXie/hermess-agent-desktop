import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { relativeImportViolations } from './architecture-dependencies.mjs'
import { commandScopes, extensionOperations } from './profile-scope-registry.mjs'

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

const typescriptSources = [
  'apps/frontend/src',
  'apps/desktop/src',
  'packages/contracts/src',
].map(directory => resolve(root, directory))
const rustSource = resolve(root, 'apps/desktop/src-tauri/src')
const checkTestSeparation = directory => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name)
    const typescriptSource = typescriptSources.some(source => directory === source || directory.startsWith(source + sep))
    if (entry.name === 'tests') {
      if (typescriptSource) failures.push(`${relative(root, file)}: move tests outside src/`)
      continue
    }
    if (entry.isDirectory()) checkTestSeparation(file)
    else if (entry.isFile() && typescriptSource && /\.test\.[cm]?[jt]sx?$/.test(entry.name)) {
      failures.push(`${relative(root, file)}: move tests outside src/`)
    } else if (entry.isFile() && directory.startsWith(rustSource) && entry.name.endsWith('.rs')) {
      const source = readFileSync(file, 'utf8')
      if (/#\[cfg\(test\)\]\s*mod\s+\w+\s*\{/m.test(source)) {
        failures.push(`${relative(root, file)}: move inline test module into a separate file`)
      }
    }
  }
}
for (const source of typescriptSources) checkTestSeparation(source)
checkTestSeparation(rustSource)

// Product-owned native processes must go through the shared lifecycle owner.
// PTY creation is wrapped by ProcessManager::launch in panel_terminal.rs;
// profile_data.rs only asks the OS to open a user-facing file manager.
const managedProcessExceptions = new Set(['process_manager.rs', 'panel_terminal.rs', 'profile_data.rs'])
const managedPlatformFiles = new Set([
  resolve(rustSource, 'process_manager/windows.rs'),
  resolve(rustSource, 'process_manager/macos.rs'),
])
const checkProcessSpawns = directory => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'tests') continue
    const file = join(directory, entry.name)
    if (entry.isDirectory()) checkProcessSpawns(file)
    else if (entry.name.endsWith('.rs') && !managedProcessExceptions.has(entry.name) && !managedPlatformFiles.has(file)) {
      const source = readFileSync(file, 'utf8')
      if (/\.spawn\s*\(|\.spawn_command\s*\(|\bcommand\.(?:output|status)\s*\(/.test(source)) {
        failures.push(`${relative(root, file)}: start product processes through process_manager`)
      }
    }
  }
}
checkProcessSpawns(rustSource)
const panelTerminalSource = readFileSync(resolve(rustSource, 'panel_terminal.rs'), 'utf8')
if ([...panelTerminalSource.matchAll(/\.spawn_command\s*\(/g)].length !== 1 || !panelTerminalSource.includes('manager.launch(')) {
  failures.push('panel_terminal.rs: PTY process must be launched inside ProcessManager::launch')
}
const profileDataSource = readFileSync(resolve(rustSource, 'runtime/profile_data.rs'), 'utf8')
if ([...profileDataSource.matchAll(/\.spawn\s*\(/g)].length !== 1 || !profileDataSource.includes('let program = "explorer.exe"')) {
  failures.push('profile_data.rs: only the external system file manager may bypass process_manager')
}

const main = readFileSync(resolve(root, 'apps/desktop/src-tauri/src/main.rs'), 'utf8')
const adapter = readFileSync(resolve(root, 'apps/desktop/src/adapter/tauriDesktopApi.ts'), 'utf8')
const quickEntryRenderer = readFileSync(resolve(root, 'apps/desktop/src/quick-entry.tsx'), 'utf8')
const gateway = readFileSync(resolve(root, 'apps/desktop/src-tauri/src/gateway.rs'), 'utf8')
const registeredBlock = main.match(/generate_handler!\[([\s\S]*?)\]/)?.[1]
if (!registeredBlock) failures.push('apps/desktop/src-tauri/src/main.rs: command registration not found')
const registered = new Set([...((registeredBlock || '').matchAll(/[\w:]+::([a-z_]+)\s*,?/g))].map(match => match[1]))
const invoked = new Set([...(adapter + '\n' + quickEntryRenderer).matchAll(/\binvoke(?:<[^>]+>)?\s*\(\s*['"]([^'"]+)/g)].map(match => match[1]))
if (!registered.size || !invoked.size) failures.push('desktop command inventory is empty')
for (const name of invoked) if (!registered.has(name)) failures.push(`adapter invokes unregistered command: ${name}`)
for (const name of registered) if (!invoked.has(name)) failures.push(`registered command has no adapter capability: ${name}`)

const runtimeDir = resolve(root, 'apps/desktop/src-tauri/src/runtime')
const profileGatewaySource = readFileSync(resolve(runtimeDir, 'profiles.rs'), 'utf8').replace(/\r\n/g, '\n')
const acceptedMethodsBlock = profileGatewaySource.match(/fn accepts_profile\([^)]*\) -> bool \{[\s\S]*?matches!\([\s\S]*?\n\s*\)\n\}/)?.[0]
if (!acceptedMethodsBlock) failures.push('runtime/profiles.rs: named Profile Gateway method list not found')
const acceptedMethods = new Set([...(acceptedMethodsBlock || '').matchAll(/"([a-z]+(?:\.[a-z_]+)+)"/g)].map(match => match[1]))
// These modules use ProfiledGateway. Include literal branches that select a
// method before calling request (for example, image.attach vs file.attach).
for (const file of ['chat.rs', 'models.rs', 'browser_bridge.rs']) {
  const source = readFileSync(resolve(runtimeDir, file), 'utf8')
  for (const [, method] of source.matchAll(/"([a-z]+(?:\.[a-z_]+)+)"/g)) {
    if (!acceptedMethods.has(method)) failures.push(`runtime/${file}: Gateway method ${method} has no named Profile route`)
  }
}
if (readFileSync(resolve(runtimeDir, 'jobs.rs'), 'utf8').includes('.request("cron.manage"') && !acceptedMethods.has('cron.manage')) {
  failures.push('runtime/jobs.rs: cron.manage has no named Profile route')
}
const nativeCommandFiles = [
  'apps/desktop/src-tauri/src/runtime/mod.rs',
  ...readdirSync(runtimeDir).filter(name => name.endsWith('.rs')).map(name => `apps/desktop/src-tauri/src/runtime/${name}`),
  'apps/desktop/src-tauri/src/diagnostics.rs',
  'apps/desktop/src-tauri/src/webview_cache.rs',
  'apps/desktop/src-tauri/src/updates.rs',
  'apps/desktop/src-tauri/src/panel_terminal.rs',
  'apps/desktop/src-tauri/src/workspace_panel.rs',
  'apps/desktop/src-tauri/src/quick_entry.rs',
]
const definedCommands = new Set()
const commandHeaders = new Map()
for (const file of nativeCommandFiles) {
  const source = readFileSync(resolve(root, file), 'utf8')
  if (!file.endsWith('/runtime/mod.rs') && !file.endsWith('/runtime/profiles.rs') && /\.selected_profile\b|\bstate\.gateway\s*\(/.test(source)) {
    failures.push(`${file}: profile operations must use resolve_profile instead of global selection`)
  }
  for (const marker of source.matchAll(/#\[tauri::command\]/g)) {
    const header = source.slice(marker.index, source.indexOf('{', marker.index))
    const name = header.match(/\bpub\s+(?:async\s+)?fn\s+(\w+)/)?.[1]
    if (!name) {
      failures.push(`${file}: command declaration could not be parsed`)
      continue
    }
    definedCommands.add(name)
    commandHeaders.set(name, header)
    const returnType = header.split('->')[1]?.trim()
    if (returnType?.startsWith('Result<') && !returnType.endsWith('DesktopFailure>')) {
      failures.push(`${file}: ${name} must return DesktopFailure`)
    }
  }
}
for (const name of registered) if (!definedCommands.has(name)) failures.push(`registered command definition not found: ${name}`)

const scopedCommands = new Map()
for (const [scope, names] of Object.entries(commandScopes)) {
  for (const name of names.trim().split(/\s+/)) {
    if (scopedCommands.has(name)) failures.push(`native command has duplicate scope: ${name}`)
    scopedCommands.set(name, scope)
  }
}
for (const name of registered) if (!scopedCommands.has(name)) failures.push(`native command has no scope declaration: ${name}`)
for (const name of scopedCommands.keys()) if (!registered.has(name)) failures.push(`scope declaration has no native command: ${name}`)
for (const [name, scope] of scopedCommands) {
  if (['profile', 'session', 'profile-or-session'].includes(scope) && !/\bprofile\s*:\s*String\b/.test(commandHeaders.get(name) || '')) {
    failures.push(`profile-bound native command lacks explicit profile argument: ${name}`)
  }
  if (scope === 'workspace' && !/\bscope\s*:\s*WorkspaceScope\b/.test(commandHeaders.get(name) || '')) {
    failures.push(`workspace-bound native command lacks explicit WorkspaceScope argument: ${name}`)
  }
}
const extensionSource = readFileSync(resolve(runtimeDir, 'extensions.rs'), 'utf8')
const jobsSource = readFileSync(resolve(runtimeDir, 'jobs.rs'), 'utf8')
const declaredOperations = new Set(extensionOperations.trim().split(/\s+/))
const handledOperations = new Set([...(extensionSource + '\n' + jobsSource).matchAll(/^\s*((?:"[a-z]+(?:\.[a-z]+)+"\s*(?:\|\s*)?)+)=>/gm)]
  .flatMap(match => [...match[1].matchAll(/"([a-z]+(?:\.[a-z]+)+)"/g)].map(value => value[1])))
for (const operation of declaredOperations) {
  if (!handledOperations.has(operation)) failures.push(`extension operation has no handler: ${operation}`)
}
for (const operation of handledOperations) if (!declaredOperations.has(operation)) failures.push(`extension handler has no scope declaration: ${operation}`)
if (!extensionSource.includes('_ => return Err(DesktopFailure::invalid_input())')) failures.push('extension operation must reject unknown values')
const frontendSources = readdirSync(resolve(root, 'apps/frontend/src'), { recursive: true, withFileTypes: true })
for (const entry of frontendSources) {
  if (entry.isFile() && /\.[jt]sx?$/.test(entry.name)) {
    const file = join(entry.parentPath, entry.name)
    if (/\bprofiles\.select\s*\(/.test(readFileSync(file, 'utf8'))) failures.push(`${relative(root, file)}: normal profile navigation must not select the backend profile`)
  }
}

const updates = readFileSync(resolve(root, 'apps/desktop/src-tauri/src/updates.rs'), 'utf8')
const nativeEventSources = [gateway, updates, ...nativeCommandFiles.map(file => readFileSync(resolve(root, file), 'utf8'))].join('\n')
const emitted = new Set([
  ...[...nativeEventSources.matchAll(/app\.emit\(\s*"([^"]+)"/g)].map(match => match[1]),
  ...[...nativeEventSources.matchAll(/app\.emit_to\(\s*"[^"]+"\s*,\s*"([^"]+)"/g)].map(match => match[1]),
])
const listened = new Set([
  ...[...adapter.matchAll(/listenPayload(?:<[^>]+>)?\(\s*['"]([^'"]+)/g)].map(match => match[1]),
  ...[...quickEntryRenderer.matchAll(/\blisten(?:<[^>]+>)?\(\s*['"]([^'"]+)/g)].map(match => match[1]),
])
if (!emitted.size || !listened.size) failures.push('desktop event inventory is empty')
for (const name of listened) if (!emitted.has(name)) failures.push(`adapter listens to event without native emitter: ${name}`)
for (const name of emitted) if (!listened.has(name)) failures.push(`native event has no adapter listener: ${name}`)

for (const feature of readdirSync(runtimeDir).filter(name => name.endsWith('.rs') && name !== 'mod.rs')) {
  const source = readFileSync(resolve(runtimeDir, feature), 'utf8')
  if (source.includes('#[tauri::command]') && /\buse\s+super::\*\s*;/.test(source)) failures.push(`runtime/${feature}: use explicit imports instead of super::*`)
}

if (failures.length) {
  console.error(`Architecture boundary violations:\n${failures.join('\n')}`)
  process.exitCode = 1
} else {
  console.log(`Architecture boundaries verified: ${registered.size} native commands and ${emitted.size} native events match the desktop adapter`)
}
