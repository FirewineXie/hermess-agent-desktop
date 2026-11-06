import test from 'node:test'
import assert from 'node:assert/strict'
import { diagnosticDocsUrl, diagnosticMutation } from '../src/features/personal-tasks/kanbanDiagnosticModel.ts'

test('diagnostic recovery actions preserve the locked Kanban request shapes', () => {
  assert.deepEqual(diagnosticMutation('t/one', 'stale_worker', { kind: 'reclaim', label: 'Reclaim' }, ''), {
    method: 'POST', path: '/tasks/t%2Fone/reclaim', body: { reason: 'recovery action for stale_worker' },
  })
  assert.deepEqual(diagnosticMutation('t_1', 'blocked', { kind: 'unblock', label: 'Unblock' }, ''), {
    method: 'PATCH', path: '/tasks/t_1', body: { status: 'ready' },
  })
  assert.deepEqual(diagnosticMutation('t_1', 'failed', { kind: 'reassign', label: 'Reassign', payload: { reclaim_first: true } }, 'research'), {
    method: 'POST', path: '/tasks/t_1/reassign', body: { profile: 'research', reclaim_first: true, reason: 'recovery action for failed' },
  })
  assert.equal(diagnosticMutation('t_1', 'failed', { kind: 'reassign', label: 'Reassign' }, ''), null)
})

test('diagnostic documentation links permit only browser-safe HTTP URLs', () => {
  assert.equal(diagnosticDocsUrl({ kind: 'open_docs', label: 'Docs', payload: { url: 'https://example.com/guide' } }), 'https://example.com/guide')
  assert.equal(diagnosticDocsUrl({ kind: 'open_docs', label: 'Docs', payload: { url: 'javascript:alert(1)' } }), null)
  assert.equal(diagnosticDocsUrl({ kind: 'cli_hint', label: 'Run', payload: { url: 'https://example.com' } }), null)
})
