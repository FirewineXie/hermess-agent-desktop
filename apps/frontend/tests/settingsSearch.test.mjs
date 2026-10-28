import assert from 'node:assert/strict'
import test from 'node:test'
import { auxiliaryTaskFromField, fieldSettingsLocation, fieldSupportsTextTarget } from '../src/features/settings/fieldSearch.ts'

test('search routes Profile schema fields to the page that renders their editor', () => {
  assert.deepEqual(fieldSettingsLocation('command_allowlist'), { category: 'security', subpage: 'approvals' })
  assert.deepEqual(fieldSettingsLocation('checkpoints.enabled'), { category: 'security', subpage: 'checkpoints' })
  assert.deepEqual(fieldSettingsLocation('auxiliary.compression.model'), { category: 'memory', subpage: 'context' })
  assert.deepEqual(fieldSettingsLocation('agent.reasoning_effort'), { category: 'model', subpage: 'main' })
  assert.deepEqual(fieldSettingsLocation('fallback_providers'), { category: 'model', subpage: 'fallbacks' })
  assert.deepEqual(fieldSettingsLocation('auxiliary.title_generation.provider'), { category: 'model', subpage: 'auxiliary' })
  assert.deepEqual(fieldSettingsLocation('auxiliary.title_generation.custom_option'), { category: 'advanced', subpage: 'raw' })
  assert.deepEqual(fieldSettingsLocation('moa.default_preset'), { category: 'model', subpage: 'moa' })
  assert.deepEqual(fieldSettingsLocation('unknown.plugin.field'), { category: 'advanced', subpage: 'raw' })
  assert.equal(fieldSupportsTextTarget('auxiliary.compression.model'), true)
  assert.equal(fieldSupportsTextTarget('fallback_providers'), false)
  assert.equal(fieldSupportsTextTarget('auxiliary.title_generation.provider'), false)
  assert.equal(auxiliaryTaskFromField('auxiliary.title_generation.provider'), 'title_generation')
  assert.equal(auxiliaryTaskFromField('auxiliary.compression.timeout'), null)
  assert.equal(auxiliaryTaskFromField('auxiliary.title_generation.custom_option'), null)
  assert.equal(fieldSupportsTextTarget('auxiliary.title_generation.custom_option'), true)
  assert.equal(fieldSupportsTextTarget('moa.default_preset'), false)
})

test('search does not advertise hidden voice conversation controls as editable fields', () => {
  assert.equal(fieldSettingsLocation('voice.gpt_live.model'), null)
  assert.equal(fieldSettingsLocation('voice.voice_chat_mode'), null)
  assert.equal(fieldSettingsLocation('cloud.login'), null)
  assert.equal(fieldSettingsLocation('ssh.update'), null)
})
