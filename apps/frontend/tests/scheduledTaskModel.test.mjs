import assert from 'node:assert/strict'
import test from 'node:test'
import { editJob, editorPayload, newEditor } from '../src/features/scheduled-tasks/scheduledTaskModel.ts'

test('new task keeps profile defaults and explicit execution context', () => {
  const editor = { ...newEditor('writer'), schedule: '0 9 * * *', prompt: 'report',
    provider: 'openrouter', model: 'sample-model', context_from: 'abcd1234ef56\nself', continuity: true }
  const payload = editorPayload(editor)
  assert.equal(payload.profile, 'writer')
  assert.equal(payload.provider, 'openrouter')
  assert.equal(payload.model, 'sample-model')
  assert.deepEqual(payload.context_from, ['abcd1234ef56', 'self'])
  assert.equal(payload.deliver, 'local')
})

test('new task starts with the locked Dashboard schedule default', () => {
  assert.equal(newEditor('writer').schedule, 'every 30m')
})

test('editing a script-only task preserves advanced settings and can clear a model override', () => {
  const editor = editJob({ id: '123456abcdef', profile: 'writer', name: 'script', prompt: '',
    schedule: { expr: '0 9 * * *' }, script: 'scripts/print.py', no_agent: true,
    provider: 'openrouter', model: 'old-model', context_from: ['self'],
    enabled_toolsets: ['web'], skills: ['research'], deliver: 'telegram', workdir: 'C:\\work' })
  assert.equal(editor.no_agent, true)
  assert.equal(editor.continuity, true)
  assert.deepEqual(editor.enabled_toolsets, ['web'])
  const payload = editorPayload({ ...editor, provider: '', model: '' })
  assert.equal(payload.provider, null)
  assert.equal(payload.model, null)
  assert.equal(payload.no_agent, true)
  assert.equal(payload.script, 'scripts/print.py')
  assert.equal(payload.id, '123456abcdef')
  assert.equal('paused' in payload, false)
})
