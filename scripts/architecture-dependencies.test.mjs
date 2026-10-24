import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { resolve } from 'node:path'
import { relativeImportViolations } from './architecture-dependencies.mjs'

const frontend = resolve(import.meta.dirname, '../apps/frontend/src')
const file = resolve(frontend, 'features/chat/ChatView.tsx')

test('allows imports within the owning project', () => {
  assert.deepEqual(relativeImportViolations("import './components/MessageList'", file, frontend), [])
})

test('rejects cross-project imports through static, exported and dynamic paths', () => {
  const source = `
    import api from '../../../../desktop/src/adapter/tauriDesktopApi'
    export { api } from '../../../../desktop/src/adapter/tauriDesktopApi'
    const lazy = import('../../../../desktop/src/adapter/tauriDesktopApi')
  `
  assert.equal(relativeImportViolations(source, file, frontend).length, 3)
})

test('rejects computed imports that cannot be checked', () => {
  assert.deepEqual(relativeImportViolations('import(path)', file, frontend), ['dynamic import path cannot be checked'])
})

test('rejects imports that enter the frontend from the desktop project', () => {
  const desktop = resolve(import.meta.dirname, '../apps/desktop/src')
  const entry = resolve(desktop, 'adapter/tauriDesktopApi.ts')
  assert.equal(relativeImportViolations("import App from '../../../frontend/src/App'", entry, desktop).length, 1)
})

test('rejects TypeScript import equals across project boundaries', () => {
  assert.equal(relativeImportViolations("import api = require('../../../../desktop/src/adapter/tauriDesktopApi')", file, frontend).length, 1)
})
